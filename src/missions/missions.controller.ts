import { DiscordClientProvider } from '@discord-nestjs/core';
import { Body, Controller, Post } from '@nestjs/common';
import {

  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ForumChannel,
  TextChannel,
} from 'discord.js';

export const REVIEW_STATE_REPROVED = 'review_reproved';
export const REVIEW_STATE_ACCEPTED = 'review_accepted';
export const REVIEW_STATE_PENDING = 'review_pending';

@Controller('missions')
export class MissionsController {
  constructor(private readonly discordProvider: DiscordClientProvider) { }

  @Post('/new')
  async newMission(@Body() body): Promise<object> {
    console.log(body);
    const newMissionEmbed = new EmbedBuilder()

      .setColor('#ffffff')
      .setTitle(body.name)
      .setAuthor({ name: `Author: ${body.author}`, iconURL: body.displayAvatarURL })
      .addFields(
        { name: 'Description:', value: body.description, inline: false },
        {
          name: 'Player Count:',
          value: `**Min:** ${body.size.min} **Max:** ${body.size.max}`,
          inline: true,
        },
        { name: 'Type:', value: body.type, inline: true },
        { name: 'Map:', value: body.terrainName, inline: true },
        {
          name: 'Tags:',
          value: body.tags.join(' | '),
          inline: false,
        },
      )
      .setTimestamp()

      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);
    if (body.mediaFileName) {
      newMissionEmbed.setImage(`https://launcher.globalconflicts.net/media/missions/${body.mediaFileName}`)
    }
    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;

    await channel.send({
      content: `${body.author} uploaded a new mission!`,
      embeds: [newMissionEmbed]
    });
    return;
  }

  @Post('/update')
  async update(@Body() body): Promise<object> {

    const discordClient = this.discordProvider.getClient();
    let missionAuthor = await discordClient.users.fetch(body.missionAuthor);

    const versionSrt = body.version.minor ? `Major: ${body.version.major} Minor: ${body.version.minor}`: `Major: ${body.version.major}`;

    const newMissionEmbed = new EmbedBuilder()

      .setColor('#ffffff')
      .setTitle(body.name)
      .setAuthor({ name: `Mission Author: ${missionAuthor.username}`, iconURL: body.displayAvatarURL })
      .addFields(
        { name: 'Version:', value: versionSrt, inline: false },
        { name: 'Changelog:', value: body.changelog, inline: false },
        {
          name: 'Player Count:',
          value: `**Min:** ${body.size.min} **Max:** ${body.size.max}`,
          inline: true,
        },
        { name: 'Type:', value: body.type, inline: true },
        { name: 'Map:', value: body.terrainName, inline: true },
        {
          name: 'Tags:',
          value: body.tags.join(' | '),
          inline: false,
        },
      )
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);


    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;
    await channel.send({ content: `${body.updateAuthor} updated a mission!`, embeds: [newMissionEmbed] });
    return;
  }

  @Post('/request_audit')
  async requestAudit(@Body() body): Promise<object> {
    const newMissionEmbed = new EmbedBuilder()
      .setColor('#22cf26')
      .setTitle(body.name)
      .setAuthor({ name: `Author: ${body.author}`, iconURL: body.displayAvatarURL })
      .setDescription(`Version: ${body.version}.`)
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_MISSION_REVIEWER_CHANNEL,
    ) as TextChannel;
    await channel.send({
      content: `<@&${process.env.DISCORD_MISSION_REVIEW_TEAM_ROLE_ID}>, a mission audit has been requested.`,
      embeds: [newMissionEmbed],
    });
    return;
  }
  @Post('/request_audit_cancel')
  async requestAuditCancel(@Body() body): Promise<object> {
    const newMissionEmbed = new EmbedBuilder()
      .setColor('#ff2020')
      .setTitle(body.name)
      .setAuthor({ name: `Author: ${body.author}`, iconURL: body.displayAvatarURL })
      .setDescription(`Version: ${body.version}.`)
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_MISSION_REVIEWER_CHANNEL,
    ) as TextChannel;
    await channel.send({
      content: `A mission audit request has been canceled.`,
      embeds: [newMissionEmbed],
    });
    return;
  }

  @Post('/audit_submited')
  async auditSubmited(@Body() body): Promise<object> {
    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;

    const newMissionEmbed = new EmbedBuilder()

      .setColor(
        `${body.reviewState === REVIEW_STATE_REPROVED ? '#ff0000' : '#56ff3b'}`,
      )
      .setTitle(`${body.name}`)

      .setDescription(
        `Version:   ${body.version}
			${body.notes != null
          ? `**Notes**:
			${body.notes}
			`
          : ''
        }
		`,
      )
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    if (body.reviewState === REVIEW_STATE_REPROVED) {
      for (const checklistElement of body.checklist) {
        if (checklistElement.value === 'FALSE') {
          newMissionEmbed.addFields(
            {
              name: checklistElement.text,
              value: checklistElement.value == 'FALSE' ? 'NO' : 'YES',
            }
          );
        }
      }
      newMissionEmbed.addFields({ name: 'Reviewer', value: `<@${body.reviewer}>` });
      await channel.send({
        content: `<@${body.authorId}>, your mission has been rejected. 🛑`,
        embeds: [newMissionEmbed],
      });
    } else {
      newMissionEmbed.addFields({ name: 'Reviewer', value: `<@${body.reviewer}>` });
      await channel.send({
        content: `<@&${process.env.DISCORD_ADMIN_ROLE_ID}>, a mission was accepted to be uploaded:\n<@${body.authorId}>, your mission has been accepted. ✅`,
        embeds: [newMissionEmbed],
      });
    }

    return;
  }

  @Post('/new_history')
  async new_Hhistory(@Body() body): Promise<object> {
    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel | ForumChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_AAR_CHANNEL,
    ) as TextChannel | ForumChannel;

    const leadersDescriptionText = body.leaders
      .map(function (elem) {
        return `<@${elem.discordID}>`;
      })
      .join(', ');

    const leadersFieldText = body.leaders
      .map(function (elem) {
        return `<@${elem.discordID}>`;
      })
      .join('\n');

    let leaderText = 'Leader:';
    if (body.leaders.length > 1) {
      leaderText = 'Leaders:';
    }
    let sendText = `New mission history recorded!\n${leadersDescriptionText}: please consider giving your AAR at the website.`;
    if (!body.isNew) {
      sendText = `A mission history was edited. \n${leadersDescriptionText}: Check it out.`;
    }

    const gameplayHistoryEmbed = new EmbedBuilder()
      .setTitle(`${body.name}`)
      .setAuthor({ name: `Author: ${body.author}`, iconURL: body.displayAvatarURL })
      .addFields({ name: 'Outcome:', value: body.outcome })
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    if (body.gmNote) {
      gameplayHistoryEmbed.addFields({ name: 'GM Notes:', value: body.gmNote });
    }
    if (body.aarReplayLink) {
      gameplayHistoryEmbed.addFields({ name: 'AAR Replay:', value: body.aarReplayLink });
    }
    gameplayHistoryEmbed.addFields({ name: leaderText, value: leadersFieldText });
    const discordButton = new ButtonBuilder()
      .setLabel('Rate this mission')
      .setCustomId(body.uniqueName)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>({ components: [discordButton] })

    if (body.discordThreadId) {
      const thread = await discordClient.channels.fetch(body.discordThreadId).catch(() => null);
      if (thread && thread.isThread()) {
        await thread.send({
          content: sendText,
          embeds: [gameplayHistoryEmbed],
          components: [row],
        });
        return {};
      }
    }

    if (channel.type === ChannelType.GuildForum) {
      const forum = channel as any;
      await forum.threads.create({
        name: `${body.name} - AAR`,
        message: {
          content: sendText,
          embeds: [gameplayHistoryEmbed],
          components: [row],
        }
      });
    } else {
      await channel.send({
        content: sendText,
        embeds: [gameplayHistoryEmbed],
        components: [row],
      });
    }
    return {};
  }

  @Post('/first_vote')
  async firstVote(@Body() body): Promise<object> {
    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_VOTING_CHANNEL,
    ) as TextChannel;

    const newMissionEmbed = new EmbedBuilder()
      .setTitle(`${body.name}`)
      .setAuthor({ name: `Author: ${body.author}`, iconURL: body.displayAvatarURL })
      .setDescription(body.description)
      .addFields(
        { name: 'Type:', value: body.type, inline: true },
        { name: 'Terrain:', value: body.terrain, inline: true },
      )
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordButton = new ButtonBuilder()
      .setLabel('Vote for this mission')
      .setCustomId(body.uniqueName)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>({ components: [discordButton] })

    await channel.send({
      content: `This mission has received its first vote:`,
      embeds: [newMissionEmbed],
      components: [row]
    });

    return;
  }

  @Post('/bugreport')
  async bugreport(@Body() body): Promise<object> {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle(`Mission: ${body.name}`)
      .setAuthor(
        {
          name: `Bug report author: ${body.reportAuthor}`,
          iconURL: body.reviewDisplayAvatarURL

        }
      )
      .addFields({ name: 'Version:', value: body.version, inline: false })
      .addFields({ name: 'Bug report:', value: body.report, inline: false })
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;
    await channel.send({
      content: `New bug report added, <@${body.authorId}>.`,
      embeds: [embed],
    });
    return;
  }

  @Post('/review')
  async review(@Body() body): Promise<object> {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle(`Mission: ${body.name}`)
      .setAuthor(
        { name: `Review author: ${body.reviewAuthor}`, iconURL: body.reviewDisplayAvatarURL, }

      )
      .addFields({ name: 'Review:', value: body.review, inline: false })
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;
    await channel.send({
      content: `New review added,  <@${body.authorId}>.`,
      embeds: [embed],
    });
    return;
  }

  @Post('/aar')
  async aar(@Body() body): Promise<object> {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle(`Mission: ${body.name}`)
      .setAuthor({ name: `AAR author: ${body.aarAuthor}`, iconURL: body.aarDisplayAvatarURL })
      .addFields({ name: 'AAR:', value: body.aar, inline: false })
      .setTimestamp()
      .setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.DISCORD_BOT_CHANNEL,
    ) as TextChannel;
    await channel.send({
      content: `An AAR was posted about your mission, <@${body.authorId}>.`,
      embeds: [embed],
    });
    return;
  }

  @Post('/media_posted')
  async mediaPosted(@Body() body): Promise<object> {
    console.log('POSTING MEDIA');
    const embed = new EmbedBuilder()
      .setColor('#0000FF')
      .setDescription('New media posted!')

      .setAuthor({
        name: `Media poster: ${body.mediaAuthor}`,
        iconURL: body.mediaDisplayAvatarURL,
      });

    if (body.name) {
      embed.setTitle(`Mission: ${body.name}`);
      embed.setURL(`https://globalconflicts.net/missions/${body.uniqueName}`);
    }

    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.ARMA_MEDIA_CHANNEL,
    ) as TextChannel;
    await channel.send({
      embeds: [embed],
    });

    for (const link of body.mediaLinkList) {
      await channel.send({
        content: link.link ?? link.cdnLink,
      });
    }

    return;
  }

  @Post('/youtube_video_uploaded')
  async youtubeVideoUploaded(@Body() body): Promise<object> {
    const discordClient = this.discordProvider.getClient();
    const channel: TextChannel = discordClient.channels.cache.get(
      process.env.PR_VIDEO_VERIFICATION_CHANNEL_ID,
    ) as TextChannel;
    await channel.send({
      content: `
      <@${body.authorId}> uploaded:\nDesired Title: ${body.title}\n${body.link}`,
    });

    return;
  }
}
