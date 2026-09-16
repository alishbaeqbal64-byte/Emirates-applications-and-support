import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  APPLICATIONS_CHANNEL_ID,
  APPLICATION_COLORS,
  DEPARTMENTS,
  SUPPORT_COLORS
} from './config.js';
import { text, messageTextWithAttachments, buildRelayEmbed } from './utils/components.js';

const EMOJI_TAIL = '<:Emiratesnewtail:1480910652427079680>';
const EMOJI_SUPPORT = '<:support:1428415390794514584>';
const FOOTER = `${EMOJI_SUPPORT} **Emirates Careers**\n-# **Fly Better**`;
const APPLY_EMOJI = '📝';

const QUESTIONS = [
  { id: 'timezone', label: 'Time zone & availability', section: 'Applicant Information', prompt: 'What is your time zone and general availability? Tell us in your own words (e.g. weekends, weekdays, or everyday — and roughly which hours).' },
  { id: 'experience', label: 'Previous staff experience', section: 'Applicant Information', prompt: 'Do you have any previous Emirates or other staff experience? Answer Yes or No — if yes, please specify where and in which role.' },
  { id: 'whyDepartment', label: 'Why this department', section: 'Department Preference', prompt: 'Why did you select your first-choice department?' },
  { id: 'contribute', label: 'What you can contribute', section: 'Department Preference', prompt: 'What do you believe you can contribute to your chosen department?' },
  { id: 'whyJoin', label: 'Why join Emirates staff', section: 'Motivation & Suitability', prompt: 'Why do you want to join the Emirates staff team?' },
  { id: 'goodStaff', label: 'What makes a good staff member', section: 'Motivation & Suitability', prompt: 'In your view, what makes a good staff member?' },
  { id: 'unknown', label: 'Handling the unknown', section: 'Motivation & Suitability', prompt: 'How would you handle a situation where you do not know what to do?' },
  { id: 'situation1', label: 'Scenario — public conflict', section: 'Situational Questions', prompt: 'Two members are arguing heatedly in a public channel and no other staff members are online. How do you resolve the situation?' },
  { id: 'situation2', label: 'Scenario — mistake & accountability', section: 'Situational Questions', prompt: 'You make a mistake while performing staff duties that affects a member, and nobody noticed it. What do you do?' }
];

const QUESTION_BY_ID = new Map(QUESTIONS.map(question => [question.id, question]));

const STEPS = [
  { kind: 'text', id: 'timezone' },
  { kind: 'text', id: 'experience' },
  { kind: 'first' },
  { kind: 'second' },
  { kind: 'text', id: 'whyDepartment' },
  { kind: 'text', id: 'contribute' },
  { kind: 'text', id: 'whyJoin' },
  { kind: 'text', id: 'goodStaff' },
  { kind: 'text', id: 'unknown' },
  { kind: 'text', id: 'situation1' },
  { kind: 'text', id: 'situation2' },
  { kind: 'commitment' }
];

const STATUS_TEXT = {
  submitted: 'Submitted — awaiting screening',
  review: 'Under review by HR',
  shortlisted: 'Shortlisted',
  interview: 'Interview stage',
  interview_done: 'Interview completed — awaiting selection',
  accepted: 'Accepted — Batch 01',
  rejected: 'Rejected'
};

const formsByUser = new Map();
const applicationsByUser = new Map();
const interviewThreads = new Map();

let client = null;

export function initApplications(clientRef) {
  client = clientRef;
}

function buildAckContainer(content) {
  return new ContainerBuilder().setAccentColor(SUPPORT_COLORS.welcome).addTextDisplayComponents(text(content));
}

export function buildApplicationIntroContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Emirates Staff Application — Batch 01__\n\n` +
          'Hello and welcome to the **Emirates Recruitment Centre.**\n\n' +
          'Thank you for your interest in joining the Emirates staff team. Your application will now begin — it contains a short set of questions about you, your preferred department, your motivation, and a few everyday situations.\n\n' +
          'The application tests potential, not prior technical knowledge — technical and operational ability are developed later through the Emirates Applicant Pathway.\n\n' +
          'When you are ready, please answer the first question below.\n\n' +
          FOOTER
      )
    );
}

function buildQuestionContainer(form) {
  const step = STEPS[form.stepIndex];
  const question = QUESTION_BY_ID.get(step.id);
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Batch 01 Staff Application__\n\n` +
          `**${question.section}** • Step ${form.stepIndex + 1} of ${STEPS.length}\n\n` +
          `${question.prompt}\n\n` +
          '-# Reply directly here in your DMs — type `cancel` at any time to withdraw your application.'
      )
    );
}

function departmentButtons(prefix, withSkip) {
  const row = new ActionRowBuilder();
  DEPARTMENTS.forEach((department, index) => {
    row.addComponents(new ButtonBuilder().setCustomId(`${prefix}:${index}`).setLabel(department).setStyle(ButtonStyle.Danger));
  });
  const rows = [row];
  if (withSkip) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${prefix}:skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary)));
  }
  return rows;
}

function buildDepartmentContainer(kind, stepNumber, selected) {
  const isFirst = kind === 'first';
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Batch 01 Staff Application__\n\n` +
          `**Department Preference** • Step ${stepNumber} of ${STEPS.length}\n\n` +
          (isFirst
            ? 'Please select your **first-choice department**:'
            : 'Optionally, select your **second-choice department** — or skip this step:') +
          (selected ? `\n\n✅ Selected: **${selected}**` : '') +
          `\n\n${DEPARTMENTS.map(department => `• ${department}`).join('\n')}`
      )
    );
}

function buildCommitmentContainer() {
  const commitmentIndex = STEPS.length;
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Batch 01 Staff Application — Commitment__\n\n` +
          `**Commitment** • Step ${commitmentIndex} of ${STEPS.length}\n\n` +
          'Before you submit, please confirm the following:\n\n' +
          '• You are willing to complete the full Emirates Applicant Pathway.\n' +
          '• You will be available for required training sessions.\n' +
          '• You understand that submitting an application does not guarantee acceptance.\n\n' +
          FOOTER
      )
    );
}

function buildSubmittedContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Application received__\n\n` +
          'Thank you — your **Batch 01** application has been submitted to our HR team for screening.\n\n' +
          'You will be notified here once your application moves to review, is shortlisted for an interview, or a final decision has been made.\n\n' +
          FOOTER
      )
    );
}

function buildCancelledContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(text(`${EMOJI_TAIL} Emirates الإمارات • __Application cancelled__\n\nYour Batch 01 application has been cancelled. You are welcome to apply again at any time.\n\n${FOOTER}`));
}

function buildStatusNoticeContainer(status) {
  const notices = {
    review: 'Your Batch 01 application is now **under review** by our HR team. Thank you for your patience.',
    shortlisted: 'Great news — your application has been **shortlisted**. Please stand by for a short interview with our team.',
    rejected: 'Thank you for applying to Emirates staff. After careful review, we are unable to accept your application for **Batch 01** at this time. You are welcome to apply again for a future batch.',
    interviewStart: 'Congratulations — your application has been accepted for the **interview stage**. You are now connected with the Emirates HR team: your messages here are relayed to them, and theirs to you. Please say hello when you are ready.',
    interviewEnd: 'Your interview has concluded. Thank you for your time — selection results for **Batch 01** will follow.'
  };
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.welcome)
    .addTextDisplayComponents(text(`${EMOJI_TAIL} Emirates الإمارات • __Application status__\n\n${notices[status]}\n\n${FOOTER}`));
}

function buildAcceptedContainer(user, department) {
  return new ContainerBuilder()
    .setAccentColor(APPLICATION_COLORS.accepted)
    .addTextDisplayComponents(
      text(
        `${EMOJI_TAIL} Emirates الإمارات • __Congratulations — your application has been accepted.__\n\n` +
          `Hello <@${user.id}>,\n\n` +
          `Following your application and interview for **Batch 01**, you have been selected to join the Emirates team${department ? ` as **${department}**` : ''}.\n\n` +
          'Welcome aboard. The Emirates Applicant Pathway and your required training will begin shortly — we look forward to flying with you.\n\n' +
          FOOTER
      )
    );
}

const QA_SECTIONS = [
  { title: 'Applicant Information', ids: ['timezone', 'experience'] },
  { title: 'Department Preference', ids: ['whyDepartment', 'contribute'] },
  { title: 'Motivation & Suitability', ids: ['whyJoin', 'goodStaff', 'unknown'] },
  { title: 'Situational Questions', ids: ['situation1', 'situation2'] }
];

function applicationActions(record) {
  if (record.status === 'accepted' || record.status === 'rejected' || record.status === 'interview_done') return [];
  if (record.status === 'interview') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`app_end:${record.userId}`).setLabel('End Interview').setStyle(ButtonStyle.Secondary)
      )
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`app_review:${record.userId}`).setLabel('Under Review').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`app_shortlist:${record.userId}`).setLabel('Shortlist').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`app_interview:${record.userId}`).setLabel('Accept → Interview').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`app_reject:${record.userId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildApplicationCardComponents(record) {
  const header = text(
    `**Emirates Staff Application — Batch 01**\n` +
      `Applicant: <@${record.userId}> • \`${record.userTag}\` • ID: ${record.userId}\n` +
      `First choice: ${record.firstDepartment ?? '—'} • Second choice: ${record.secondDepartment ?? '—'}\n` +
      `Status: **${STATUS_TEXT[record.status]}**\n` +
      `Submitted: <t:${Math.floor(record.submittedAt / 1000)}:f>`
  );
  const qa = QA_SECTIONS.map(section =>
    text(
      `**${section.title}**\n` +
        section.ids
          .map(id => `**${QUESTION_BY_ID.get(id).label}**\n${record.answers[id] ?? '—'}`)
          .join('\n\n')
    )
  );
  const container = new ContainerBuilder().setAccentColor(APPLICATION_COLORS[record.status] ?? APPLICATION_COLORS.submitted);
  container.addTextDisplayComponents(header, ...qa);
  return [container, ...applicationActions(record)];
}

async function updateApplicationCard(record) {
  const channel = await client.channels.fetch(APPLICATIONS_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('Applications channel is not a text channel.');
  const message = await channel.messages.fetch(record.messageId);
  await message.edit({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
}

async function sendStep(user, form) {
  const step = STEPS[form.stepIndex];
  if (!step) return;
  if (step.kind === 'text') {
    await user.send({ components: [buildQuestionContainer(form)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (step.kind === 'first' || step.kind === 'second') {
    await user.send({
      components: [buildDepartmentContainer(step.kind, form.stepIndex + 1), ...departmentButtons(`app_${step.kind}`, step.kind === 'second')],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }
  if (step.kind === 'commitment') {
    await user.send({
      components: [
        buildCommitmentContainer(),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('app_commit:yes').setLabel('I Acknowledge & Submit').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('app_commit:no').setLabel('Cancel Application').setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.IsComponentsV2
    });
  }
}

export async function startApplication(user, { sendIntro = true } = {}) {
  if (applicationsByUser.has(user.id)) return { ok: false, reason: 'already-applied' };
  let form = formsByUser.get(user.id);
  if (!form) {
    form = { userId: user.id, userTag: user.tag, stepIndex: 0, answers: {}, firstDepartment: null, secondDepartment: null };
    formsByUser.set(user.id, form);
    if (sendIntro) {
      await user.send({ components: [buildApplicationIntroContainer()], flags: MessageFlags.IsComponentsV2 });
    }
  }
  await sendStep(user, form);
  return { ok: true };
}

async function submitApplication(user, form) {
  formsByUser.delete(user.id);
  const channel = APPLICATIONS_CHANNEL_ID ? await client.channels.fetch(APPLICATIONS_CHANNEL_ID).catch(() => null) : null;
  if (!channel?.isTextBased()) {
    console.error('APPLICATIONS_CHANNEL_ID is not set or invalid — application could not be posted.');
    await user.send({ content: 'Applications are temporarily closed — our recruitment channel is not configured. Please try again later.' });
    return;
  }

  const record = {
    ...form,
    status: 'submitted',
    messageId: null,
    threadId: null,
    submittedAt: Date.now()
  };
  const message = await channel.send({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
  record.messageId = message.id;
  applicationsByUser.set(user.id, record);
  await user.send({ components: [buildSubmittedContainer()], flags: MessageFlags.IsComponentsV2 });
}

export async function handleFormDm(message) {
  const form = formsByUser.get(message.author.id);
  if (!form) return false;

  const content = message.content.trim();
  if (content.toLowerCase() === 'cancel') {
    formsByUser.delete(message.author.id);
    await message.reply({ components: [buildCancelledContainer()], flags: MessageFlags.IsComponentsV2 });
    return true;
  }

  const step = STEPS[form.stepIndex];
  if (step?.kind !== 'text') {
    await message.reply('Please use the buttons above to continue your application.');
    return true;
  }
  if (!content) {
    await message.reply('Please type your answer to continue the application.');
    return true;
  }

  form.answers[step.id] = content.slice(0, 1000);
  form.stepIndex += 1;
  await sendStep(message.author, form);
  return true;
}

export async function handleInterviewDm(message) {
  const record = applicationsByUser.get(message.author.id);
  if (!record || record.status !== 'interview' || !record.threadId) return false;
  const thread = await client.channels.fetch(record.threadId).catch(() => null);
  if (!thread?.isTextBased()) return false;
  await thread.send({ embeds: [buildRelayEmbed(message.author.tag, message.author.displayAvatarURL(), messageTextWithAttachments(message))] });
  return true;
}

export async function relayInterviewThreadMessage(message) {
  const userId = interviewThreads.get(message.channel.id);
  if (!userId) return false;
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;
  await user.send({ embeds: [buildRelayEmbed(message.member?.displayName ?? message.author.username, message.author.displayAvatarURL(), messageTextWithAttachments(message))] });
  return true;
}

async function archiveInterviewThread(record) {
  if (!record.threadId) return;
  interviewThreads.delete(record.threadId);
  const thread = await client.channels.fetch(record.threadId).catch(() => null);
  if (thread?.isTextBased()) {
    await thread.send({ embeds: [buildRelayEmbed('Emirates HR', client.user.displayAvatarURL(), `Interview ended by <@${record.closedBy ?? 'staff'}>.`)] }).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }
}

export async function handleInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('app_')) return false;
  const [action, value] = interaction.customId.slice(4).split(':');

  if (action === 'first' || action === 'second') {
    const form = formsByUser.get(interaction.user.id);
    const step = form ? STEPS[form.stepIndex] : null;
    if (!form || !step || step.kind !== action) {
      await interaction.reply({ content: 'This selection has expired — please restart your application by DMing the bot.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const department = value === 'skip' ? null : DEPARTMENTS[Number(value)];
    if (action === 'first') form.firstDepartment = department;
    else form.secondDepartment = department;
    const stepNumber = form.stepIndex + 1;
    form.stepIndex += 1;
    const disabledRows = departmentButtons(`app_${action}`, action === 'second');
    disabledRows.forEach(row => row.components.forEach(button => button.setDisabled(true)));
    await interaction.update({
      components: [
        buildDepartmentContainer(action, stepNumber, department ?? (action === 'second' ? 'No second choice' : null)),
        ...disabledRows
      ],
      flags: MessageFlags.IsComponentsV2
    });
    await sendStep(interaction.user, form);
    return true;
  }

  if (action === 'commit') {
    const form = formsByUser.get(interaction.user.id);
    if (!form) {
      await interaction.update({ components: [buildAckContainer('This application has already been completed or cancelled.')], flags: MessageFlags.IsComponentsV2 });
      return true;
    }
    if (value === 'no') {
      formsByUser.delete(interaction.user.id);
      await interaction.update({ components: [buildCancelledContainer()], flags: MessageFlags.IsComponentsV2 });
      return true;
    }
    await interaction.update({ components: [buildAckContainer('Submitting your application — thank you for your patience.')], flags: MessageFlags.IsComponentsV2 });
    await submitApplication(interaction.user, form);
    return true;
  }

  const record = applicationsByUser.get(value);
  if (!record) {
    await interaction.reply({ content: 'This application could not be found.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'review' || action === 'shortlist') {
    record.status = action === 'review' ? 'review' : 'shortlisted';
    await interaction.update({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
    await client.users.fetch(record.userId).then(user => user.send({ components: [buildStatusNoticeContainer(record.status)], flags: MessageFlags.IsComponentsV2 })).catch(() => null);
    return true;
  }

  if (action === 'reject') {
    record.status = 'rejected';
    record.closedBy = interaction.user.id;
    await interaction.update({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
    await archiveInterviewThread(record);
    await client.users.fetch(record.userId).then(user => user.send({ components: [buildStatusNoticeContainer('rejected')], flags: MessageFlags.IsComponentsV2 })).catch(() => null);
    applicationsByUser.delete(record.userId);
    return true;
  }

  if (action === 'interview') {
    const thread = await interaction.message.startThread({
      name: `interview-${record.userTag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 90),
      autoArchiveDuration: 1440
    });
    record.status = 'interview';
    record.threadId = thread.id;
    interviewThreads.set(thread.id, record.userId);
    await interaction.update({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
    await thread.send({
      embeds: [buildRelayEmbed('Emirates HR', client.user.displayAvatarURL(), `Interview started for <@${record.userId}> (first choice: **${record.firstDepartment ?? '—'}**). Messages sent here are relayed to the applicant.`)]
    });
    await client.users.fetch(record.userId).then(user => user.send({ components: [buildStatusNoticeContainer('interviewStart')], flags: MessageFlags.IsComponentsV2 })).catch(() => null);
    return true;
  }

  if (action === 'end') {
    record.status = 'interview_done';
    record.closedBy = interaction.user.id;
    await interaction.update({ components: buildApplicationCardComponents(record), flags: MessageFlags.IsComponentsV2 });
    await archiveInterviewThread(record);
    await client.users.fetch(record.userId).then(user => user.send({ components: [buildStatusNoticeContainer('interviewEnd')], flags: MessageFlags.IsComponentsV2 })).catch(() => null);
    return true;
  }

  return false;
}

export const acceptCommand = new SlashCommandBuilder()
  .setName('accept')
  .setDescription('Notify an applicant they have been accepted into Batch 01')
  .addUserOption(option => option.setName('user').setDescription('Applicant to accept').setRequired(true))
  .addStringOption(option =>
    option
      .setName('server')
      .setDescription('Server invite link to include in the DM')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('department')
      .setDescription('Department the applicant is accepted into')
      .setRequired(false)
      .addChoices(...DEPARTMENTS.map(department => ({ name: department, value: department })))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function handleAcceptCommand(interaction) {
  const user = interaction.options.getUser('user', true);
  const server = interaction.options.getString('server')?.trim();
  const department = interaction.options.getString('department');

  if (server && !/^https?:\/\//i.test(server)) {
    await interaction.reply({ content: 'The server link must be a valid URL starting with `http://` or `https://`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const components = [buildAcceptedContainer(user, department)];
  if (server) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Join the server').setStyle(ButtonStyle.Link).setURL(server)
      )
    );
  }

  const sent = await user.send({ components, flags: MessageFlags.IsComponentsV2 }).catch(() => null);
  if (!sent) {
    await interaction.reply({ content: `Could not DM ${user} — they may have DMs closed.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const record = applicationsByUser.get(user.id);
  if (record) {
    record.status = 'accepted';
    await updateApplicationCard(record).catch(() => null);
  }
  await interaction.reply({ content: `Acceptance sent to ${user}${department ? ` (${department})` : ''}.`, flags: MessageFlags.Ephemeral });
}

export async function registerApplicationCommands(readyClient) {
  const command = acceptCommand.toJSON();
  await Promise.all(readyClient.guilds.cache.map(guild => guild.commands.set([command])));
}
