/**
 * Emirates Applications & Support — Discord support-system bot.
 *
 * Flow:
 *   1. A user DMs the bot and picks "General Support" or "Partnership Support"
 *      from a dropdown menu.
 *   2. The bot opens a thread (support-<name> / partnership-<name>) in the
 *      configured staff channel, pings the matching staff roles, posts the
 *      welcome + connected embeds there, relays the message that started the
 *      request, and confirms in the user's DMs with a Close button.
 *   3. Every message staff send inside the thread is relayed to the user's
 *      DMs, and every DM the user sends is relayed into the thread — both as
 *      compact author / content / timestamp embeds.
 *   4. Staff (/close inside the thread) or the user (Close button in DMs)
 *      closes the request: the green "Emirates Support Request" embed is
 *      posted in the thread, the user receives a copy, and the thread is
 *      archived and locked.
 *
 * Configuration is environment-only so it deploys cleanly on Railway
 * (see .env.example for local runs and railway.json for deployment).
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const GENERAL = 'general';
const PARTNERSHIP = 'partnership';

const WELCOME_DESCRIPTION = [
  '**Emirates** • We have received your message and are connecting you with a customer service agent.',
  '',
  'Hello and welcome to **Emirates Customer Service Centre**.',
  '',
  'Thank you for contacting us. A member of our support team will be with you shortly to assist you as quickly and efficiently as possible.',
  '',
  'Please enter your issue so our support team can assist you.',
].join('\n');

const DROPDOWN_PROMPT = 'Please select the type of support you require from the menu below.';
const TICKET_OPENED_CONFIRMATION =
  'Your support request has been opened. A member of our support team will be with you shortly — you can send your messages right here.';

// --------------------------------------------------------------------------- //
// Configuration
// --------------------------------------------------------------------------- //

function splitIds(raw, fallback) {
  const source = raw === undefined || raw === '' ? fallback.join(',') : raw;
  return source
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const config = {
  token: process.env.DISCORD_TOKEN,
  // Defaults baked in from the server this bot is configured for;
  // every value can be overridden through environment variables.
  supportChannelId: process.env.SUPPORT_CHANNEL_ID || '1549096181903401130',
  guildId: process.env.GUILD_ID || null,
  generalRoleIds: splitIds(process.env.GENERAL_ROLE_IDS, ['1449091238107283639', '1473706134467510364']),
  partnershipRoleIds: splitIds(process.env.PARTNERSHIP_ROLE_IDS, ['1468302255181529295', '1475109255945392229']),
  staffRoleId: process.env.STAFF_ROLE_ID || null,
  closePingRoleId: process.env.CLOSE_PING_ROLE_ID || null,
};

// --------------------------------------------------------------------------- //
// Ticket storage (survives restarts; note Render's free disk is ephemeral)
// --------------------------------------------------------------------------- //

// Override (e.g. TICKETS_PATH=/data/tickets.json) to store the registry in a
// mounted volume on hosts like Railway; defaults to the project directory.
const TICKETS_PATH = process.env.TICKETS_PATH || path.join(__dirname, 'tickets.json');
const tickets = new Map(); // userId -> { userId, threadId, type }
const threadsToUsers = new Map(); // threadId -> userId
const pendingOpeners = new Map(); // userId -> the DM that triggered the dropdown

function loadTickets() {
  try {
    const raw = fs.readFileSync(TICKETS_PATH, 'utf8');
    for (const [userId, data] of Object.entries(JSON.parse(raw))) {
      tickets.set(userId, data);
      threadsToUsers.set(data.threadId, userId);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not load tickets.json:', err.message);
  }
}

function saveTickets() {
  try {
    fs.writeFileSync(TICKETS_PATH, JSON.stringify(Object.fromEntries(tickets), null, 2));
  } catch (err) {
    console.error('Could not save tickets.json:', err.message);
  }
}

function registerTicket(userId, threadId, type) {
  tickets.set(userId, { userId, threadId, type });
  threadsToUsers.set(threadId, userId);
  saveTickets();
}

function removeTicket({ userId = null, threadId = null } = {}) {
  if (threadId !== null) {
    userId = threadsToUsers.get(threadId) ?? null;
  } else if (userId !== null) {
    threadId = tickets.get(userId)?.threadId ?? null;
  }
  if (userId !== null) tickets.delete(userId);
  if (threadId !== null) threadsToUsers.delete(threadId);
  if (userId !== null || threadId !== null) saveTickets();
  return userId;
}

// --------------------------------------------------------------------------- //
// Client
// --------------------------------------------------------------------------- //

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// --------------------------------------------------------------------------- //
// Embeds and components
// --------------------------------------------------------------------------- //

function welcomeEmbed() {
  return new EmbedBuilder()
    .setDescription(WELCOME_DESCRIPTION)
    .setFooter({ text: 'Emirates Customer Service — Beyond Borders' });
}

function connectedEmbed(user) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setDescription(
      `Connected. <@${user.id}> has been selected for your inquiry. Please be patient while they review your request.`
    );
}

function relayEmbed(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const attachment of message.attachments.values()) parts.push(attachment.url);
  let description = parts.join('\n') || '*Empty message*';
  if (description.length > 4000) description = `${description.slice(0, 4000)}…`;
  return new EmbedBuilder()
    .setAuthor({ name: message.author.displayName ?? message.author.username })
    .setDescription(description)
    .setTimestamp(message.createdAt);
}

function closeEmbed(ticket, closer, reason) {
  const embed = new EmbedBuilder()
    .setTitle('Emirates Support Request')
    .setColor(0x57f287)
    .setTimestamp()
    .addFields(
      { name: 'Passenger', value: `<@${ticket.userId}>` },
      { name: 'Status', value: `Closed by <@${closer.id}>` }
    );
  if (config.closePingRoleId) {
    embed.addFields({ name: 'Ping', value: `<@&${config.closePingRoleId}>` });
  }
  embed.addFields({ name: 'Message', value: reason });
  return embed;
}

function selectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('support:type_select')
      .setPlaceholder('Select the type of support you require')
      .addOptions(
        { label: 'General Support', value: GENERAL, description: 'General questions and assistance' },
        { label: 'Partnership Support', value: PARTNERSHIP, description: 'Partnership and collaboration requests' }
      )
  );
}

function closeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support:close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

// --------------------------------------------------------------------------- //
// Ticket lifecycle
// --------------------------------------------------------------------------- //

function isStaff(member) {
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages) || member.permissions?.has(PermissionFlagsBits.ManageThreads)) {
    return true;
  }
  return Boolean(config.staffRoleId) && member.roles?.cache?.has(config.staffRoleId);
}

async function createTicket(user, type, initialMessage = null) {
  const channel = await client.channels.fetch(config.supportChannelId).catch(() => null);
  if (!channel || !channel.guild) {
    throw new Error('support channel not found — check SUPPORT_CHANNEL_ID');
  }

  const prefix = type === GENERAL ? 'support' : 'partnership';
  const thread = await channel.threads.create({
    name: `${prefix}-${user.username}`,
    autoArchiveDuration: 10080,
    reason: `${prefix} support request from ${user.tag} (${user.id})`,
  });

  registerTicket(user.id, thread.id, type);

  const roleIds = type === GENERAL ? config.generalRoleIds : config.partnershipRoleIds;
  const content = roleIds.map((id) => `<@&${id}>`).join(' ');
  if (content) {
    await thread.send({ content, allowedMentions: { roles: roleIds } });
  }
  await thread.send({ embeds: [welcomeEmbed()] });
  await thread.send({ embeds: [connectedEmbed(user)] });
  if (initialMessage) {
    await thread.send({ embeds: [relayEmbed(initialMessage)] });
  }

  try {
    await user.send({ embeds: [welcomeEmbed()], components: [closeRow()] });
  } catch {
    await thread
      .send('Could not send this passenger a direct message — they may have DMs disabled.')
      .catch(() => {});
  }
  return thread;
}

async function closeTicket(ticket, thread, closer, reason = 'Support request closed.') {
  const embed = closeEmbed(ticket, closer, reason);
  const content = config.closePingRoleId ? `<@&${config.closePingRoleId}>` : undefined;
  await thread
    .send({
      content,
      embeds: [embed],
      allowedMentions: { roles: config.closePingRoleId ? [config.closePingRoleId] : [] },
    })
    .catch(() => {});

  removeTicket({ userId: ticket.userId });

  try {
    const opener = await client.users.fetch(ticket.userId);
    await opener.send({ embeds: [embed] });
  } catch {
    // DMs disabled — nothing more we can do.
  }

  await thread.setArchived(true, `Closed by ${closer.tag}`).catch(() => {});
  await thread.setLocked(true).catch(() => {});
}

async function handleDM(message) {
  const ticket = tickets.get(message.author.id);
  if (ticket) {
    let thread = null;
    try {
      thread = await client.channels.fetch(ticket.threadId);
    } catch {
      thread = null;
    }
    if (!thread) {
      removeTicket({ userId: message.author.id });
      await message.author
        .send('Your previous support request is no longer available. Please send a new message to open a fresh one.')
        .catch(() => {});
      await message.author.send({ content: DROPDOWN_PROMPT, components: [selectRow()] }).catch(() => {});
      return;
    }
    await thread.send({ embeds: [relayEmbed(message)] }).catch(() => {});
    return;
  }

  pendingOpeners.set(message.author.id, message);
  await message.author.send({ content: DROPDOWN_PROMPT, components: [selectRow()] }).catch(() => {});
}

// --------------------------------------------------------------------------- //
// Interaction handlers
// --------------------------------------------------------------------------- //

async function handleSelect(interaction) {
  if (tickets.has(interaction.user.id)) {
    return interaction.reply({
      content: 'You already have an open support request — just send your messages here.',
      ephemeral: true,
    });
  }

  const type = interaction.values[0];
  const initial = pendingOpeners.get(interaction.user.id) ?? null;
  pendingOpeners.delete(interaction.user.id);

  await interaction.deferUpdate();
  try {
    await createTicket(interaction.user, type, initial);
  } catch (err) {
    console.error('Could not create ticket:', err);
    return interaction.editReply({ content: `Could not open your support request: ${err.message}`, components: [] });
  }
  await interaction.editReply({ content: TICKET_OPENED_CONFIRMATION, components: [] });
}

async function handleCloseButton(interaction) {
  const ticket = tickets.get(interaction.user.id);
  if (!ticket) {
    return interaction.reply({ content: 'You do not have an open support request.', ephemeral: true });
  }
  let thread = null;
  try {
    thread = await client.channels.fetch(ticket.threadId);
  } catch {
    thread = null;
  }
  if (!thread) {
    removeTicket({ userId: interaction.user.id });
    return interaction.reply({ content: 'This support request no longer exists.', ephemeral: true });
  }
  await interaction.reply({ content: 'Closing your support request…', ephemeral: true });
  await closeTicket(ticket, thread, interaction.user);
}

async function handleCloseCommand(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used inside a support thread.', ephemeral: true });
  }
  const openerId = threadsToUsers.get(interaction.channelId);
  const ticket = openerId ? tickets.get(openerId) : null;
  if (!ticket) {
    return interaction.reply({ content: 'This thread is not an open support request.', ephemeral: true });
  }
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'You do not have permission to close support requests.', ephemeral: true });
  }
  const reason = interaction.options.getString('reason') || 'Support request closed.';
  await interaction.deferReply({ ephemeral: true });
  await closeTicket(ticket, interaction.channel, interaction.user, reason);
  await interaction.editReply('Support request closed.');
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'close') await handleCloseCommand(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'support:type_select') {
      await handleSelect(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'support:close') {
      await handleCloseButton(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// --------------------------------------------------------------------------- //
// Gateway events
// --------------------------------------------------------------------------- //

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (!message.guild) {
    await handleDM(message);
    return;
  }

  const openerId = threadsToUsers.get(message.channelId);
  if (openerId && message.author.id !== openerId) {
    try {
      const opener = await client.users.fetch(openerId);
      await opener.send({ embeds: [relayEmbed(message)] });
    } catch {
      await message.channel
        .send('Could not relay that message to the passenger — they may have DMs disabled.')
        .catch(() => {});
    }
  }
});

client.on(Events.ThreadDelete, async (thread) => {
  const openerId = threadsToUsers.get(thread.id);
  if (!openerId) return;
  removeTicket({ threadId: thread.id });
  try {
    const opener = await client.users.fetch(openerId);
    await opener.send('Your support request has been closed.');
  } catch {
    // DMs disabled — nothing more we can do.
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} — passengers can DM the bot to open a support request.`);

  const closeCommand = new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the current support request (staff only).')
    .addStringOption((option) =>
      option.setName('reason').setDescription('Message shown in the closing embed').setRequired(false)
    )
    .toJSON();

  try {
    let guildId = config.guildId;
    if (!guildId && config.supportChannelId) {
      const channel = await client.channels.fetch(config.supportChannelId).catch(() => null);
      guildId = channel?.guildId ?? null;
    }
    const rest = new REST().setToken(config.token);
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), { body: [closeCommand] });
      console.log(`Slash commands registered for guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(readyClient.user.id), { body: [closeCommand] });
      console.log('Slash commands registered globally.');
    }
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// --------------------------------------------------------------------------- //
// Health-check HTTP server (optional; useful for host health checks)
// --------------------------------------------------------------------------- //

const PORT = Number(process.env.PORT) || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', openTickets: tickets.size }));
  })
  .listen(PORT, () => console.log(`Health check server listening on port ${PORT}`));

// --------------------------------------------------------------------------- //

async function main() {
  loadTickets();
  if (!config.token || config.token === 'your-bot-token') {
    console.error('Set the DISCORD_TOKEN environment variable (see .env.example for local runs).');
    process.exit(1);
  }
  await client.login(config.token);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
