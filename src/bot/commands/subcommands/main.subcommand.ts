import { SlashCommandPipe } from '@discord-nestjs/common';
import {
  DiscordClientProvider,
  EventParams,
  Handler,
  InteractionEvent,
  Param,
  SubCommand,
} from '@discord-nestjs/core';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
  ChatInputCommandInteraction,
  ClientEvents,
  TextChannel,
} from 'discord.js';
import permissionCheck from 'src/helpers/restart_stop_command_perms_check';
import {
  handleServerData,
  updateDefaultScenario,
} from 'src/helpers/reforger_server';

class MainSubCommandParams {
  @Param({ description: 'Mission GUID', required: false })
  missionguid: string;
}

@SubCommand({
  name: 'main',
  description:
    'Starts/Restarts the main server. This is the regular server for sessions.',
})
export class MainServerSubCommand {
  constructor(private readonly discordProvider: DiscordClientProvider) {}

  @Handler()
  onServerSelectCommand(
    @InteractionEvent(SlashCommandPipe) options: MainSubCommandParams,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): string {
    const member = args[0].member;
    const channel = args[0].channel as TextChannel;

    let action = 'restart';
    if (args[0] instanceof ChatInputCommandInteraction) {
      action = args[0].options['_group'];
    }
    const permCheck = permissionCheck(member);

    if (permCheck != true) {
      return permCheck;
    }

    let child: ChildProcessWithoutNullStreams;

    if (options.missionguid && process.env.REFORGER_SERVER_CONFIG_PATH) {
      channel.send(
        member?.user?.username +
          ' set main config scenario id to ' +
          options.missionguid,
      );
      updateDefaultScenario(
        options.missionguid,
        `${process.env.REFORGER_SERVER_CONFIG_PATH}\\config.json`,
      );
    }

    if (action == 'restart') {
      channel.send(member?.user?.username + ' restarted main server');
      child = spawn('powershell.exe', [
        `${process.env.MAIN_REFORGER_SERVER_START_SCRIPT_PATH}\\start.ps1`,
      ]);
    } else {
      channel.send(member?.user?.username + ' stopped main server');
      child = spawn('powershell.exe', [
        `${process.env.MAIN_REFORGER_SERVER_START_SCRIPT_PATH}\\stop.ps1`,
      ]);
    }

    child.stdout.on('data', async function (data) {
      return handleServerData(data, channel);
    });
    child.stderr.on('data', function (data) {
      return handleServerData(data, channel);
    });

    child.stdin.end();
  }
}
