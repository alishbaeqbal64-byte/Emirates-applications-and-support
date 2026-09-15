import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials
} from 'discord.js';
import { SUPPORT_COLORS, SUPPORT_PING_ROLE_ID, SUPPORT_REQUESTS_CHANNEL_ID } from './config.js';
import { text } from './utils/components.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN in environment.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const supportTicketsByUser = new Map();
const supportTicketsByThread = new Map();

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

function messageTextWithAttachments(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }
  return parts.join('\n') || '(No text content)';
}

function displayTime() {
  return `<t:${Math.floor(Date.now() / 1000)}:f>`;
}

function supportStatusText(ticket) {
  if (ticket.status === 'closed') return `Closed${ticket.closedBy ? ` by <@${ticket.closedBy}>` : ''}`;
  if (ticket.claimedBy) return `Claimed by <@${ticket.claimedBy}> - in progress`;
  return 'Waiting for staff';
}

function supportColor(ticket) {
  if (ticket.status === 'closed') return SUPPORT_COLORS.closed;
  if (ticket.claimedBy) return SUPPORT_COLORS.inProgress;
  return SUPPORT_COLORS.unclaimed;
}

function buildSupportActions(userId, ticket) {
  if (ticket.status === 'closed') return [];

  const row = new ActionRowBuilder();
  if (!ticket.claimedBy) {
    row.addComponents(new ButtonBuilder().setCustomId(`support_claim:${userId}`).setLabel('Claim').setStyle(ButtonStyle.Success));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`support_close:${userId}`).setLabel('Close').setStyle(ButtonStyle.Danger));
  return [row];
}

function buildSupportRequestContainer(user, content, ticket) {
  return new ContainerBuilder()
    .setAccentColor(supportColor(ticket))
    .addTextDisplayComponents(
      text(
        `**Emirates Support Request**\n` +
          `Passenger: <@${user.id}>\n` +
          `Status: ${supportStatusText(ticket)}\n` +
          `Ping: <@&${SUPPORT_PING_ROLE_ID}>\n\n` +
          `**Message**\n${content}\n\n` +
          `${displayTime()}`
      )
    );
}

function buildSupportConnectingContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.relay)
    .addTextDisplayComponents(
      text(
        '**Emirates Airways** • __We have received your message and are connecting you with a customer service agent.__\n\n' +
          'Hello and welcome to **Emirates Customer Service Centre**.\n\n' +
          'Thank you for contacting us. A member of our support team will be with you shortly to assist you as quickly and efficiently as possible.\n\n' +
          'Please enter your issue so our support team can assist you.\n\n' +
          '**Emirates Airways Customer Service**\n' +
          '-# **BEYOND BORDERS**'
      )
    );
}

function buildSupportConnectedContainer(agent) {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.inProgress)
    .addTextDisplayComponents(text(`Connected. ${agent} has been selected for your inquiry. Please be patient while they review your request.`));
}

function buildSupportClosedContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.closed)
    .addTextDisplayComponents(text('Your Emirates support request has been closed. Thank you for contacting us.'));
}

function buildRelayContainer(authorName, content) {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.relay)
    .addTextDisplayComponents(text(`**${authorName}**\n${content}\n\n${displayTime()}`));
}

async function updateSupportRequestMessage(ticket, content) {
  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');

  const requestMessage = await supportChannel.messages.fetch(ticket.requestMessageId);
  const user = await client.users.fetch(ticket.userId);
  await requestMessage.edit({
    components: [buildSupportRequestContainer(user, content, ticket), ...buildSupportActions(ticket.userId, ticket)],
    flags: MessageFlags.IsComponentsV2
  });
}

async function createSupportRequest(message) {
  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');

  const ticket = {
    userId: message.author.id,
    userTag: message.author.tag,
    requestMessageId: null,
    threadId: null,
    claimedBy: null,
    closedBy: null,
    status: 'pending'
  };

  const requestMessage = await supportChannel.send({
    components: [buildSupportRequestContainer(message.author, 'Waiting for passenger issue.', ticket), ...buildSupportActions(message.author.id, ticket)],
    flags: MessageFlags.IsComponentsV2
  });

  ticket.requestMessageId = requestMessage.id;
  const thread = await requestMessage.startThread({
    name: `support-${ticket.userTag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 90),
    autoArchiveDuration: 1440
  });
  ticket.threadId = thread.id;
  supportTicketsByUser.set(message.author.id, ticket);
  supportTicketsByThread.set(thread.id, message.author.id);

  await thread.send({
    components: [buildRelayContainer('Emirates Support', `Support request opened for ${message.author.tag}. Waiting for the passenger issue.`)],
    flags: MessageFlags.IsComponentsV2
  });
  await message.reply({ components: [buildSupportConnectingContainer()], flags: MessageFlags.IsComponentsV2 });
}

async function forwardUserMessageToSupport(message, ticket, content) {
  if (ticket.status === 'closed') {
    supportTicketsByUser.delete(message.author.id);
    await createSupportRequest(message);
    return;
  }

  if (ticket.threadId) {
    const thread = await client.channels.fetch(ticket.threadId);
    if (!thread?.isTextBased()) throw new Error('Saved support thread is not a text channel.');
    await thread.send({ components: [buildRelayContainer(message.author.tag, content)], flags: MessageFlags.IsComponentsV2 });
    await updateSupportRequestMessage(ticket, content).catch(() => null);
    return;
  }

  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');
  await supportChannel.send({
    components: [buildRelayContainer(`${message.author.tag} added a message`, content)],
    flags: MessageFlags.IsComponentsV2
  });
  await message.reply('Your message has been added to your support request. Please wait while we connect you to an agent.');
}

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot) return;

    if (!message.guild) {
      const content = messageTextWithAttachments(message);
      const ticket = supportTicketsByUser.get(message.author.id);
      if (!ticket) {
        await createSupportRequest(message);
        return;
      }
      await forwardUserMessageToSupport(message, ticket, content);
      return;
    }

    const userId = supportTicketsByThread.get(message.channel.id);
    if (!userId) return;

    const ticket = supportTicketsByUser.get(userId);
    if (!ticket || ticket.status === 'closed') return;

    const user = await client.users.fetch(userId);
    await user.send({
      components: [buildRelayContainer(message.member?.displayName ?? message.author.username, messageTextWithAttachments(message))],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('support_close_confirm:')) {
      const userId = interaction.customId.split(':')[1];
      const ticket = supportTicketsByUser.get(userId);
      if (!ticket) {
        await interaction.update({ content: 'This support request could not be found.', components: [] });
        return;
      }

      ticket.status = 'closed';
      ticket.closedBy = interaction.user.id;
      supportTicketsByUser.delete(userId);
      if (ticket.threadId) supportTicketsByThread.delete(ticket.threadId);

      await updateSupportRequestMessage(ticket, 'Support request closed.');
      const user = await client.users.fetch(userId);
      await user.send({ components: [buildSupportClosedContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => null);

      if (ticket.threadId) {
        const thread = await client.channels.fetch(ticket.threadId).catch(() => null);
        if (thread?.isTextBased()) {
          await thread.send({
            components: [buildRelayContainer('Emirates Support', `Closed by <@${interaction.user.id}>.`)],
            flags: MessageFlags.IsComponentsV2
          });
          await thread.setArchived(true).catch(() => null);
        }
      }

      await interaction.update({ content: 'Support request closed.', components: [] });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_close_cancel:')) {
      await interaction.update({ content: 'Close cancelled.', components: [] });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_close:')) {
      const userId = interaction.customId.split(':')[1];
      await interaction.reply({
        content: 'Close this support request?',
        flags: MessageFlags.Ephemeral,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`support_close_confirm:${userId}`).setLabel('Confirm close').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`support_close_cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
          )
        ]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_claim:')) {
      const userId = interaction.customId.split(':')[1];
      const ticket = supportTicketsByUser.get(userId);
      if (!ticket) {
        await interaction.reply({ content: 'This support request could not be found.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (ticket.claimedBy) {
        await interaction.reply({ content: `This support request is already claimed in <#${ticket.threadId}>.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const thread =
        (ticket.threadId ? await client.channels.fetch(ticket.threadId).catch(() => null) : null) ??
        (await interaction.message.startThread({
          name: `support-${ticket.userTag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 90),
          autoArchiveDuration: 1440
        }));

      ticket.threadId = thread.id;
      ticket.claimedBy = interaction.user.id;
      ticket.status = 'claimed';
      supportTicketsByThread.set(thread.id, userId);

      const user = await client.users.fetch(userId);
      await interaction.update({
        components: [buildSupportRequestContainer(user, 'Support request claimed. Continue in the created thread.', ticket), ...buildSupportActions(userId, ticket)],
        flags: MessageFlags.IsComponentsV2
      });
      await thread.send({
        components: [buildRelayContainer('Emirates Support', `Claimed by <@${interaction.user.id}>. Messages sent here will be relayed to ${user}.`)],
        flags: MessageFlags.IsComponentsV2
      });
      await user.send({ components: [buildSupportConnectedContainer(interaction.user)], flags: MessageFlags.IsComponentsV2 });
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Error while processing support request.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

client.login(token);
