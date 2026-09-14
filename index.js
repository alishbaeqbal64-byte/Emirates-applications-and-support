const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || "1549096181903401130";
const GUILD_ID = process.env.GUILD_ID || "";
const TICKETS_PATH = path.resolve(
  process.env.TICKETS_PATH || path.join(process.cwd(), "tickets.json"),
);

const GENERAL_ROLE_IDS = parseIds(
  process.env.GENERAL_ROLE_IDS || "1449091238107283639,1473706134467510364",
);
const PARTNERSHIP_ROLE_IDS = parseIds(
  process.env.PARTNERSHIP_ROLE_IDS || "1468302255181529295,1475109255945392229",
);
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";
const CLOSE_PING_ROLE_ID = process.env.CLOSE_PING_ROLE_ID || "";

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing. Add it to the environment before starting the bot.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const activeTickets = new Map();
const pendingIntakes = new Map();

function parseIds(value) {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{15,25}$/.test(id));
}

function loadTickets() {
  try {
    const raw = fs.readFileSync(TICKETS_PATH, "utf8");
    const saved = JSON.parse(raw);
    const tickets = Array.isArray(saved) ? saved : saved.tickets;

    if (!Array.isArray(tickets)) return;
    for (const ticket of tickets) {
      if (ticket?.userId && ticket?.threadId) {
        activeTickets.set(ticket.userId, ticket);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not load tickets:", error.message);
    }
  }
}

function saveTickets() {
  try {
    fs.mkdirSync(path.dirname(TICKETS_PATH), { recursive: true });
    fs.writeFileSync(TICKETS_PATH, JSON.stringify([...activeTickets.values()], null, 2));
  } catch (error) {
    console.error("Could not save tickets:", error.message);
  }
}

function truncate(text, maxLength = 3900) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 55) || "passenger";
}

function attachmentText(message) {
  return [...message.attachments.values()]
    .map((attachment) => `[${attachment.name || "Attachment"}](${attachment.url})`)
    .join("\n");
}

function messageText(message) {
  const content = message.cleanContent?.trim() || message.content?.trim() || "";
  const attachments = attachmentText(message);
  return truncate([content, attachments].filter(Boolean).join("\n\n") || "(No text content)");
}

function userDisplayName(user) {
  return user.globalName || user.username || "Discord user";
}

function userAvatar(user) {
  return user.displayAvatarURL({ extension: "png", size: 128 });
}

function typeConfig(type) {
  if (type === "partnership") {
    return {
      label: "Partnership Support",
      roles: PARTNERSHIP_ROLE_IDS,
      color: 0xf2c94c,
    };
  }

  return {
    label: "General Support",
    roles: GENERAL_ROLE_IDS,
    color: 0x2f80ed,
  };
}

function selectionRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("support-type")
    .setPlaceholder("Choose a support type")
    .addOptions(
      {
        label: "General Support",
        description: "For general passenger support requests",
        value: "general",
      },
      {
        label: "Partnership Support",
        description: "For partnership and business requests",
        value: "partnership",
      },
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createWelcomeEmbed(type) {
  const config = typeConfig(type);

  return new EmbedBuilder()
    .setColor(0x20242a)
    .setAuthor({
      name: "Emirates Airways • We have received your message and are connecting you with a customer service agent.",
    })
    .setDescription(
      "Hello and welcome to Emirates Customer Service Centre.\n\n" +
        "Thank you for contacting us. A member of our support team will be with you shortly to assist you as quickly and efficiently as possible.\n\n" +
        "Please enter your issue so our support team can assist you.",
    )
    .setFooter({ text: "Emirates Airways Customer Service • BEYOND BORDERS" })
    .setTimestamp();
}

function createConnectedEmbed(user, type) {
  const config = typeConfig(type);

  return new EmbedBuilder()
    .setColor(config.color)
    .setDescription(
      `Connected. ${user} has been selected for your ${config.label.toLowerCase()} request. Please be patient while our team reviews your request.`,
    )
    .setTimestamp();
}

function createRelayEmbed({ author, displayName, body, timestamp, color = 0x5865f2 }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: displayName || userDisplayName(author), iconURL: userAvatar(author) })
    .setDescription(truncate(body || "(No text content)"))
    .setTimestamp(timestamp || Date.now());
}

function createClosedEmbed(ticket, closer, reason) {
  const pingValue = CLOSE_PING_ROLE_ID ? `<@&${CLOSE_PING_ROLE_ID}>` : "—";

  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Emirates Support Request")
    .addFields(
      { name: "Passenger", value: `<@${ticket.userId}>`, inline: false },
      { name: "Status", value: `Closed by ${closer}`, inline: false },
      { name: "Ping", value: pingValue, inline: false },
      { name: "Message", value: truncate(reason || "Support request closed.", 1024), inline: false },
    )
    .setTimestamp();
}

function findTicketByThreadId(threadId) {
  return [...activeTickets.values()].find((ticket) => ticket.threadId === threadId);
}

async function fetchTicketThread(ticket) {
  const channel = await client.channels.fetch(ticket.threadId);
  if (!channel || !channel.isThread()) {
    throw new Error("The ticket thread no longer exists.");
  }

  if (channel.archived) {
    await channel.setArchived(false).catch(() => {});
  }

  return channel;
}

async function sendSelectionMenu(user) {
  await user.send({
    content: "Please choose the type of support you need:",
    components: [selectionRow()],
    allowedMentions: { parse: [] },
  });
}

async function openTicket(user, type) {
  if (activeTickets.has(user.id)) {
    const existing = activeTickets.get(user.id);
    await user.send({
      content: `You already have an open support request: <#${existing.threadId}>.`,
      allowedMentions: { parse: [] },
    });
    return existing;
  }

  const supportChannel = await client.channels.fetch(SUPPORT_CHANNEL_ID);
  if (!supportChannel?.threads?.create) {
    throw new Error(`Support channel ${SUPPORT_CHANNEL_ID} is not a text channel that can contain threads.`);
  }

  const config = typeConfig(type);
  const threadName = `support-${slugify(user.username)}-${crypto.randomBytes(2).toString("hex")}`.slice(0, 100);
  const thread = await supportChannel.threads.create({
    name: threadName,
    autoArchiveDuration: 1440,
    reason: `${config.label} request from ${user.tag}`,
  });

  const ticket = {
    userId: user.id,
    threadId: thread.id,
    guildId: supportChannel.guildId,
    type,
    createdAt: new Date().toISOString(),
  };

  activeTickets.set(user.id, ticket);
  saveTickets();

  try {
    const roleMentions = config.roles.map((id) => `<@&${id}>`).join(" " );
    await thread.send({
      content: roleMentions || "New support request received.",
      allowedMentions: { roles: config.roles },
    });
    await thread.send({ embeds: [createWelcomeEmbed(type)] });

    await user.send({
      embeds: [createWelcomeEmbed(type), createConnectedEmbed(user, type)],
      allowedMentions: { users: [user.id] },
    });

    const pending = pendingIntakes.get(user.id);
    if (pending) {
      await thread.send({
        embeds: [
          createRelayEmbed({
            author: user,
            displayName: userDisplayName(user),
            body: pending.body,
            timestamp: pending.timestamp,
            color: config.color,
          }),
        ],
        allowedMentions: { parse: [] },
      });
      pendingIntakes.delete(user.id);
    }
  } catch (error) {
    activeTickets.delete(user.id);
    saveTickets();
    await thread.delete("Could not finish creating the support request").catch(() => {});
    throw error;
  }

  return ticket;
}

async function closeTicket(ticket, closer, reason) {
  const thread = await fetchTicketThread(ticket);
  const user = await client.users.fetch(ticket.userId);
  const closedEmbed = createClosedEmbed(ticket, closer, reason);

  await thread.send({
    embeds: [closedEmbed],
    allowedMentions: {
      users: [ticket.userId],
      roles: CLOSE_PING_ROLE_ID ? [CLOSE_PING_ROLE_ID] : [],
    },
  });
  await user.send({
    embeds: [closedEmbed],
    allowedMentions: {
      users: [ticket.userId],
      roles: CLOSE_PING_ROLE_ID ? [CLOSE_PING_ROLE_ID] : [],
    },
  });

  activeTickets.delete(ticket.userId);
  saveTickets();
  await thread.setLocked(true).catch(() => {});
  await thread.setArchived(true).catch(() => {});
}

function canCloseTicket(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageThreads)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  return Boolean(STAFF_ROLE_ID && member.roles?.cache?.has(STAFF_ROLE_ID));
}

async function handleDirectMessage(message) {
  const ticket = activeTickets.get(message.author.id);

  if (ticket) {
    try {
      const thread = await fetchTicketThread(ticket);
      await thread.send({
        embeds: [
          createRelayEmbed({
            author: message.author,
            displayName: userDisplayName(message.author),
            body: messageText(message),
            timestamp: message.createdTimestamp,
            color: typeConfig(ticket.type).color,
          }),
        ],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("Could not relay passenger DM:", error.message);
      await message.author.send("Your support request could not be reached right now. Please try again shortly.");
    }
    return;
  }

  const existingPending = pendingIntakes.get(message.author.id);
  if (existingPending) {
    existingPending.body = truncate(`${existingPending.body}\n\n${messageText(message)}`);
    return;
  }

  pendingIntakes.set(message.author.id, {
    body: messageText(message),
    timestamp: message.createdTimestamp,
  });
  await sendSelectionMenu(message.author);
}

async function handleThreadMessage(message) {
  if (!message.channel.isThread()) return;

  const ticket = findTicketByThreadId(message.channel.id);
  if (!ticket) return;

  try {
    const user = await client.users.fetch(ticket.userId);
    await user.send({
      embeds: [
        createRelayEmbed({
          author: message.author,
          displayName: message.member?.displayName || userDisplayName(message.author),
          body: messageText(message),
          timestamp: message.createdTimestamp,
          color: typeConfig(ticket.type).color,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("Could not relay staff message:", error.message);
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    if (message.channel.isDMBased()) {
      await handleDirectMessage(message);
      return;
    }

    await handleThreadMessage(message);
  } catch (error) {
    console.error("Message handling error:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "support-type") {
      const type = interaction.values[0] === "partnership" ? "partnership" : "general";
      await interaction.update({
        content: "Connecting you with the Emirates support team...",
        components: [],
      });

      try {
        const ticket = await openTicket(interaction.user, type);
        await interaction.followUp({
          content: `Your request is now connected to <#${ticket.threadId}>. You can continue replying here.`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error("Could not open support ticket:", error);
        await interaction.followUp({
          content: "I could not create the support request right now. Please try again shortly.",
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== "close") return;

    if (!interaction.channel?.isThread()) {
      await interaction.reply({ content: "This command can only be used inside a support thread." });
      return;
    }

    const ticket = findTicketByThreadId(interaction.channel.id);
    if (!ticket) {
      await interaction.reply({ content: "This is not an active support thread." });
      return;
    }

    if (!canCloseTicket(interaction.member)) {
      await interaction.reply({ content: "You do not have permission to close support requests." });
      return;
    }

    await interaction.deferReply();
    const reason = interaction.options.getString("reason") || "Support request closed.";
    await closeTicket(ticket, interaction.user, reason);
    await interaction.editReply("The support request has been closed and the thread has been archived.");
  } catch (error) {
    console.error("Interaction handling error:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong while handling that request." }).catch(() => {});
    }
  }
});

async function registerCommands() {
  const closeCommand = new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close this support request")
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Optional closing message")
        .setMaxLength(1000)
        .setRequired(false),
    );

  if (GUILD_ID) {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.commands.set([closeCommand]);
  } else {
    await client.application.commands.set([closeCommand]);
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", botReady: client.isReady() }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health server listening on port ${port}`);
  });
}

loadTickets();
startHealthServer();

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("Emirates Support");

  try {
    await registerCommands();
    console.log("Registered the /close command.");
  } catch (error) {
    console.error("Could not register the /close command:", error.message);
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Discord login failed:", error.message);
  process.exit(1);
});
