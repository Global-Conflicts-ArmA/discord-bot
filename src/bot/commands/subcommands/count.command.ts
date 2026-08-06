import { SlashCommandPipe } from '@discord-nestjs/common';
import { Command, DiscordClientProvider, EventParams, Handler, InteractionEvent, Param, ParamType } from '@discord-nestjs/core';
import { ChatInputCommandInteraction, ClientEvents, Message, Role } from 'discord.js';

const COMMAND_SETTINGS = {
  adminRoleId: '1449981020144402583',
  gameModeratorRoleId: '1475620468408189080',
  memberRoleId: '1449994769005678603',
};

interface PollAnswerResult {
  label: string;
  admins: number;
  gameModerators: number;
  members: number;
  weightedScore: number;
}

function resolveRoleBucket(roleIds: string[], settings: typeof COMMAND_SETTINGS): 'Admins' | 'Game Moderators' | 'Members' | null {
  if (roleIds.includes(settings.adminRoleId)) {
    return 'Admins';
  }

  if (roleIds.includes(settings.gameModeratorRoleId)) {
    return 'Game Moderators';
  }

  if (roleIds.includes(settings.memberRoleId)) {
    return 'Members';
  }

  return null;
}

async function sendEphemeralFailure(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.deferred) {
    try {
      await interaction.deleteReply();
    } catch {
      // Ignore cleanup failures and fall back to a follow-up.
    }
  }

  await interaction.followUp({ content, ephemeral: true });
}

class CountCommandParams {
  @Param({ name: 'messageid', description: 'The message ID of the poll', required: true, type: ParamType.STRING })
  messageid: string;

  @Param({ name: 'ephemeral', description: 'Want command result to be visible only to you?', required: false, type: ParamType.BOOLEAN })
  ephemeral?: boolean;

  @Param({ name: 'weighted', description: 'Show the weighted summary of the winning result', required: false, type: ParamType.BOOLEAN })
  weighted?: boolean;
}

@Command({
  name: 'count',
  description: 'Counts poll votes by role bucket (Admins, Game Moderators, Members).',
})
export class CountCommand {
  constructor(private readonly discordProvider: DiscordClientProvider) {}

  @Handler()
  async onCountCommand(
    @InteractionEvent(SlashCommandPipe) options: CountCommandParams,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;

    if (!interaction.guild || !interaction.member) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: options.ephemeral ?? false });

    try {
      const guild = interaction.guild;
      const messageId = options.messageid.trim();
      const channel = interaction.channel;

      if (!channel?.isTextBased()) {
        await sendEphemeralFailure(interaction, 'This command must be used in a text channel.');
        return;
      }

      let message: Message | null = null;
      try {
        message = await channel.messages.fetch(messageId);
      } catch {
        await sendEphemeralFailure(interaction, 'Could not find that message in this channel. Please make sure you used the correct message ID.');
        return;
      }

      if (!message.poll) {
        await sendEphemeralFailure(interaction, 'That message is not a Discord poll.');
        return;
      }

      const countedUsers = new Set<string>();
      const pollResults: PollAnswerResult[] = [];

      for (const [_, answer] of message.poll.answers) {
        const voters = await answer.voters.fetch();
        const result: PollAnswerResult = {
          label: answer.text ?? `Answer ${pollResults.length + 1}`,
          admins: 0,
          gameModerators: 0,
          members: 0,
          weightedScore: 0,
        };

        for (const voter of voters.values()) {
          if (countedUsers.has(voter.id)) {
            continue;
          }

          const guildMember = await guild.members.fetch(voter.id).catch(() => null);
          if (!guildMember) {
            continue;
          }

          const bucket = resolveRoleBucket(guildMember.roles.cache.map((role: Role) => role.id), COMMAND_SETTINGS);
          if (!bucket) {
            continue;
          }

          if (bucket === 'Admins') {
            result.admins += 1;
          } else if (bucket === 'Game Moderators') {
            result.gameModerators += 1;
          } else {
            result.members += 1;
          }

          countedUsers.add(voter.id);
        }

        pollResults.push(result);
      }

      const totalGameModerators = pollResults.reduce((sum, result) => sum + result.gameModerators, 0);
      const totalMembers = pollResults.reduce((sum, result) => sum + result.members, 0);

      for (const result of pollResults) {
        const hasGameModeratorMajority = totalGameModerators > 0 && result.gameModerators > totalGameModerators / 2;
        const hasMemberMajority = totalMembers > 0 && result.members > totalMembers / 2;
        result.weightedScore = result.admins + (hasGameModeratorMajority ? 1 : 0) + (hasMemberMajority ? 1 : 0);
      }

      const lines: string[] = [];
      lines.push('Poll results:', '');
      lines.push(...pollResults.map((result) => `- ${result.label}: Admins ${result.admins} | Game Moderators ${result.gameModerators} | Members ${result.members}`));

      if (options.weighted === true) {
        const winningResult = pollResults.reduce((best, current) => {
          return current.weightedScore > best.weightedScore ? current : best;
        }, pollResults[0]);

        if (winningResult) {
          lines.push('');
          lines.push(`${winningResult.label} wins with ${winningResult.weightedScore} vote${winningResult.weightedScore === 1 ? '' : 's'}`);
        }
      }

      await interaction.editReply({ content: lines.join('\n') });
    } catch (error) {
      console.error('Error in count command:', error);
      await sendEphemeralFailure(interaction, `An error occurred while counting votes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
