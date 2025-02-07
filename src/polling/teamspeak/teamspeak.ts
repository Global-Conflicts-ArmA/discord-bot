/* eslint-disable prettier/prettier */
import { AttachmentBuilder, Client, EmbedBuilder, TextChannel, Message } from 'discord.js';
import Time from '../../helpers/time';
import Settings from './settings';

import Pageres from 'pageres';
import { COLOR_OK } from '../../helpers/colors';

import { tmpdir } from 'os';
import { existsSync } from 'fs';

export default async function MayPostTeamspeakViewer(discordClient: Client<boolean>) {
  try {
    await new Pageres({ delay: 5, filename: 'screenshot' })
      .src(process.env.TS3_VIEWER_URL, ['500x50'])
      .dest(tmpdir())
      .run();
    if (existsSync(`${tmpdir()}/screenshot.png`)) {
      // If an embed was already posted

      const embed = new EmbedBuilder()
        .setColor(COLOR_OK)
        .setTitle(`TS3`)
        .setDescription('TS3 Viewer')
        .setThumbnail(
          'https://globalconflicts.net/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fbanner.8d01371c.png&w=1080&q=100',
        );

      const file = new AttachmentBuilder(`${tmpdir()}/screenshot.png`);
      embed.setImage(`attachment://screenshot.png`);

      let ts3messageId = '';
      const settings = Settings.get();
      if (settings.ts3messageId && settings.lastTS3MessageTime) {
        if (
          Time.getDiffMinutes(
            new Date(),
            new Date(settings.lastTS3MessageTime),
          ) < 5
        ) {
          ts3messageId = settings.ts3messageId;
        }
      }
      const ts3channel: TextChannel = discordClient.channels.cache.get(
        process.env.TS3_CHANNEL_ID,
      ) as TextChannel;
      const messageManager = ts3channel.messages;
      const messages = await messageManager.channel.messages.fetch({ limit: 99 });
      ts3channel.bulkDelete(messages,true);
      const id = await postMessageTS3(embed, file, ts3channel);
      Settings.set('ts3messageId', id);
      Settings.set('lastTS3MessageTime', new Date().toISOString());
    }
  } catch (error) {
    console.error(error);
  }
}

function postMessageTS3(
  content: EmbedBuilder | string,
  file: AttachmentBuilder,
  ts3channel: TextChannel,
): Promise<string> {
  return new Promise((resolve, reject) => {
    ts3channel
      .send(
        typeof content === 'string'
          ? content
          : { embeds: [content], files: [file] },
      )
      .then((messages) => {
        if (Array.isArray(messages)) {
          resolve(messages[0].id);
        } else {
          resolve(messages.id);
        }
      })
      .catch((error) => reject(error));
  });
}
