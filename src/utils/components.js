import { EmbedBuilder, TextDisplayBuilder } from 'discord.js';
import { SUPPORT_COLORS } from '../config.js';

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function messageTextWithAttachments(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }
  return parts.join('\n') || '(No text content)';
}

export function buildRelayEmbed(authorName, avatarUrl, content) {
  return new EmbedBuilder()
    .setColor(SUPPORT_COLORS.relay)
    .setAuthor({ name: authorName, iconURL: avatarUrl })
    .setDescription(content)
    .setTimestamp();
}
