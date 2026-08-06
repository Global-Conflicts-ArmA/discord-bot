import { BotGateway } from './bot.gateway';
import { DiscordModule } from '@discord-nestjs/core';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { TestServersCommands } from './commands/server/testservers.command';
import { MainServerSubCommand } from './commands/subcommands/main.subcommand';
import { ConflictServerSubCommand } from './commands/subcommands/conflict.subcommand';
import { StartTimeCommand } from './commands/subcommands/starttime.command';
import { RoleScanCommand } from './commands/subcommands/rolescan.command';
import { BanCommand } from './commands/subcommands/ban.command';
import { GuestResetCommand } from './commands/subcommands/guestreset.command';
import { CountCommand } from './commands/subcommands/count.command';
import { SwearJarModule } from '../swear-jar/swear-jar.module';
import { VoiceRolesModule } from '../voice-roles/voice-roles.module';
import { PonyBotListener } from '../PonyBot/PonyBot.listener';
import { ReactionHandler } from './events/reaction.handler';
import { SessionsModule } from '../sessions/sessions.module';
import { TempEventOpsModule } from '../temp-event-ops/temp-event-ops.module';
import { EventConfigCommand } from '../temp-event-ops/commands/event-config.command';
import { EventSetupCommand } from '../temp-event-ops/commands/event-setup.command';
import { EventTeardownCommand } from '../temp-event-ops/commands/event-teardown.command';
import { EventSignupCommand } from '../temp-event-ops/commands/event-signup.command';
import { EventDeslotCommand } from '../temp-event-ops/commands/event-deslot.command';
import { EventStatusCommand } from '../temp-event-ops/commands/event-status.command';
import { EventHelpCommand } from '../temp-event-ops/commands/event-help.command';
import { EventSyncCommand } from '../temp-event-ops/commands/event-sync.command';
import { EventAdminHelpCommand } from '../temp-event-ops/commands/event-admin-help.command';
import { EventOpsInteractionsHandler } from '../temp-event-ops/events/event-ops-interactions.handler';


@Module({
  imports: [
    DiscordModule.forFeature(),
    ScheduleModule.forRoot(),
    SwearJarModule,
    VoiceRolesModule,
    SessionsModule,
    TempEventOpsModule,
  ],
  exports: [DiscordModule],
  providers: [
    BotGateway,
    TestServersCommands,
    MainServerSubCommand,
    ConflictServerSubCommand,
    StartTimeCommand,
    RoleScanCommand,
    BanCommand,
    GuestResetCommand,
    CountCommand,
    PonyBotListener,
    ReactionHandler,
    // TEMPORARY — quick event signup system, see src/temp-event-ops/README.md.
    // Delete this block + the module/imports above + src/temp-event-ops/ to remove.
    EventConfigCommand,
    EventSetupCommand,
    EventTeardownCommand,
    EventSignupCommand,
    EventDeslotCommand,
    EventStatusCommand,
    EventHelpCommand,
    EventSyncCommand,
    EventAdminHelpCommand,
    EventOpsInteractionsHandler,
  ],
})
export class BotModule { }
