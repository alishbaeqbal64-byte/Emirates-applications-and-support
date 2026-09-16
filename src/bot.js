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
import {
  SUPPORT_COLORS,
  SUPPORT_PING_ROLE_IDS,
  SUPPORT_REQUESTS_CHANNEL_ID
} from './config.js';
import { text, messageTextWithAttachments, buildRelayEmbed } from './utils/components.js';
import * as applications from './applications.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN in environment.');
}

const CATEGORIES = {
  general: {
    label: 'General Support',
    emoji: '<:support:1428415390794514584>',
    buttonEmoji: { name: 'support', id: '1428415390794514584' }
  },
  partnership: {
    label: 'Partnership Request',
    emoji: '<:handshake:1374010015911776376>',
    buttonEmoji: { name: 'handshake', id: '1374010015911776376' }
  }
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

applications.initApplications(client);

const supportTicketsByUser = new Map();
const supportTicketsByThread = new Map();
const pendingCategorySelect = new Set();

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  applications.registerApplicationCommands(readyClient).catch(error => console.error('Failed to register application commands:', error));
});

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

function categoryLine(type) {
  const category = CATEGORIES[type];
  return `${category.emoji} **${category.label}**`;
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

function buildCategorySelectContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        '<:Emiratesnewtail:1480910652427079680> Emirates الإمارات • __Welcome to the Emirates Customer Service Centre.__\n\n' +
          'How can our team assist you today? Select an option below to continue — general support, a partnership request, or a Batch 01 staff application.\n\n' +
          '<:support:1428415390794514584> **Emirates Customer Service**\n' +
          '-# **Fly Better**'
      )
    );
}

function buildCategorySelectActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support_category:general').setLabel('General Support').setStyle(ButtonStyle.Danger).setEmoji(CATEGORIES.general.buttonEmoji),
    new ButtonBuilder().setCustomId('support_category:partnership').setLabel('Partnership Request').setStyle(ButtonStyle.Danger).setEmoji(CATEGORIES.partnership.buttonEmoji),
    new ButtonBuilder().setCustomId('support_category:apply').setLabel('Staff Application').setStyle(ButtonStyle.Danger).setEmoji('📝')
  );
}

function buildSupportWelcomeContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        '<:Emiratesnewtail:1480910652427079680> Emirates الإمارات • __We have received your message and are connecting you with a customer service agent.__\n\n' +
          'Hello and welcome to <:support:1428415390794514584> **Emirates Customer Service.**\n\n' +
          'Thank you for contacting us. A member of our support team will be with you shortly to assist you as quickly and efficiently as possible.\n\n' +
          'Please enter your issue so our support team can assist you.\n\n' +
          '<:support:1428415390794514584> **Emirates Customer Service**\n' +
          '-# **Fly Better**'
      )
    );
}

function buildSupportRequestContainer(user, content, ticket) {
  return new ContainerBuilder()
    .setAccentColor(supportColor(ticket))
    .addTextDisplayComponents(
      text(
        `**Emirates Support Request**\n` +
          `Passenger: <@${user.id}>\n` +
          `Request Type: ${categoryLine(ticket.type)}\n` +
          `Status: ${supportStatusText(ticket)}\n` +
          `Ping: ${SUPPORT_PING_ROLE_IDS[ticket.type].map(id => `<@&${id}>`).join(' ')}\n\n` +
          `**Message**\n${content}\n\n` +
          `${displayTime()}`
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

function buildSystemRelayEmbed(content) {
  return buildRelayEmbed('Emirates Support', client.user.displayAvatarURL(), content);
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

async function sendCategorySelect(message) {
  pendingCategorySelect.add(message.author.id);
  await message.reply({
    components: [buildCategorySelectContainer(), buildCategorySelectActions()],
    flags: MessageFlags.IsComponentsV2
  });
}

async function createSupportRequest(user, type) {
  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');

  const ticket = {
    userId: user.id,
    userTag: user.tag,
    type,
    requestMessageId: null,
    threadId: null,
    claimedBy: null,
    closedBy: null,
    status: 'pending'
  };

  const requestMessage = await supportChannel.send({
    components: [buildSupportRequestContainer(user, 'Waiting for passenger issue.', ticket), ...buildSupportActions(user.id, ticket)],
    flags: MessageFlags.IsComponentsV2
  });

  ticket.requestMessageId = requestMessage.id;
  const thread = await requestMessage.startThread({
    name: `support-${ticket.userTag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 90),
    autoArchiveDuration: 1440
  });
  ticket.threadId = thread.id;
  supportTicketsByUser.set(user.id, ticket);
  supportTicketsByThread.set(thread.id, user.id);

  await thread.send({
    embeds: [buildSystemRelayEmbed(`Support request opened for ${user.tag} (${CATEGORIES[type].label}). Waiting for the passenger issue.`)]
  });
}

async function forwardUserMessageToSupport(message, ticket, content) {
  if (ticket.status === 'closed') {
    supportTicketsByUser.delete(message.author.id);
    await sendCategorySelect(message);
    return;
  }

  if (ticket.threadId) {
    const thread = await client.channels.fetch(ticket.threadId);
    if (!thread?.isTextBased()) throw new Error('Saved support thread is not a text channel.');
    await thread.send({ embeds: [buildRelayEmbed(message.author.tag, message.author.displayAvatarURL(), content)] });
    await updateSupportRequestMessage(ticket, content).catch(() => null);
    return;
  }

  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');
  await supportChannel.send({
    embeds: [buildRelayEmbed(`${message.author.tag} added a message`, message.author.displayAvatarURL(), content)]
  });
  await message.reply('Your message has been added to your support request. Please wait while we connect you to an agent.');
}

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot) return;

    if (!message.guild) {
      if (await applications.handleFormDm(message)) return;

      const content = messageTextWithAttachments(message);
      const ticket = supportTicketsByUser.get(message.author.id);
      if (ticket) {
        await forwardUserMessageToSupport(message, ticket, content);
        return;
      }
      if (await applications.handleInterviewDm(message)) return;

      if (pendingCategorySelect.has(message.author.id)) {
        await message.reply('Please select an option using the buttons above so we can connect you with the right team.');
        return;
      }
      await sendCategorySelect(message);
      return;
    }

    const userId = supportTicketsByThread.get(message.channel.id);
    if (userId) {
      const ticket = supportTicketsByUser.get(userId);
      if (!ticket || ticket.status === 'closed') return;

      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [buildRelayEmbed(message.member?.displayName ?? message.author.username, message.author.displayAvatarURL(), messageTextWithAttachments(message))]
      });
      return;
    }

    await applications.relayInterviewThreadMessage(message);
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'accept') {
      await applications.handleAcceptCommand(interaction);
      return;
    }

    if (await applications.handleInteraction(interaction)) return;

    if (interaction.isButton() && interaction.customId.startsWith('support_category:')) {
      const type = interaction.customId.split(':')[1];
      if (type !== 'general' && type !== 'partnership' && type !== 'apply') {
        await interaction.update({ content: 'Unknown request type.', components: [] });
        return;
      }
      if (supportTicketsByUser.has(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an open support request. Please continue there.', flags: MessageFlags.Ephemeral });
        return;
      }

      pendingCategorySelect.delete(interaction.user.id);
      if (type === 'apply') {
        const result = await applications.startApplication(interaction.user, { sendIntro: false });
        if (!result.ok) {
          await interaction.reply({ content: 'You have already submitted an application. Please wait for its outcome before applying again.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.update({ components: [applications.buildApplicationIntroContainer()] });
        return;
      }

      await interaction.update({ components: [buildSupportWelcomeContainer()] });
      await createSupportRequest(interaction.user, type);
      return;
    }

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
            embeds: [buildSystemRelayEmbed(`Closed by <@${interaction.user.id}>.`)]
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
        embeds: [buildSystemRelayEmbed(`Claimed by <@${interaction.user.id}>. Messages sent here will be relayed to ${user}.`)]
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
