import { SlashCommandPipe } from "@discord-nestjs/common";
import { DiscordClientProvider, EventParams, Handler, IA, InteractionEvent, Param, SubCommand } from "@discord-nestjs/core";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { ChatInputCommandInteraction, ClientEvents, GuildMemberRoleManager, TextChannel } from "discord.js";
import permissionCheck from "src/helpers/restart_stop_command_perms_check";
import { handleServerData, updateDefaultScenario } from "src/helpers/reforger_server";

class ConflictSubCommandParams {
    @Param({ description: 'Mission GUID', required: false })
    missionguid: string;
}

@SubCommand({ name: 'conflict', description: 'Starts/Restarts the conflict server. This is the server for weekday, non-organized gameplay.', })
export class ConflictServerSubCommand {
    constructor(private readonly discordProvider: DiscordClientProvider) { }

    @Handler()
    onServerSelectCommand(@InteractionEvent(SlashCommandPipe) options: ConflictSubCommandParams, @EventParams() args: ClientEvents['interactionCreate'], ): string {
        const member = args[0].member;
        const channel = args[0].channel as TextChannel;

        let action = "restart";
        if (args[0] instanceof ChatInputCommandInteraction) {
            action = args[0].options["_group"];
        }
        const permCheck = permissionCheck(member)

        if (permCheck != true) {
            return permCheck
        }

        let child: ChildProcessWithoutNullStreams;

        if (options.missionguid && process.env.REFORGER_SERVER_CONFIG_PATH) {
            channel.send(member?.user?.username + ' set scenario id to ' + options.missionguid);
            updateDefaultScenario(options.missionguid, `${process.env.REFORGER_SERVER_CONFIG_PATH}\\conflict.json`)
        }


        if (action == "restart") {
            channel.send(member?.user?.username + ' restarted conflict server');
            child = spawn('powershell.exe', [
                `${process.env.MAIN_REFORGER_SERVER_START_SCRIPT_PATH}\\start-conflict.ps1`,
            ]);
        } else {
            channel.send(member?.user?.username + ' stopped conflict server');
            child = spawn('powershell.exe', [`${process.env.MAIN_REFORGER_SERVER_START_SCRIPT_PATH}\\stop-conflict.ps1`,]);
        }

        child.stdout.on('data', async function (data) {
            return handleServerData(data, channel)
        });
        child.stderr.on('data', function (data) {
            return handleServerData(data, channel)
        });

        child.stdin.end();
    }
}
