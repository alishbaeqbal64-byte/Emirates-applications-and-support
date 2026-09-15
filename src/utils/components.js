import { TextDisplayBuilder } from 'discord.js';

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}
