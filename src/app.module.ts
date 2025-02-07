import { BotModule } from './bot/bot.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersController } from './users/users.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MissionsController } from './missions/missions.controller';
import { MongoModule } from 'nest-mongodb';
import { DiscordModule } from '@discord-nestjs/core';
import { GatewayIntentBits } from 'discord.js';
 

@Module({
  imports: [
    ConfigModule.forRoot(),
    DiscordModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get('DISCORD_BOT_TOKEN'),
        registerCommandOptions: [
          {
            forGuild: configService.get('DISCORD_SERVER_ID'),
            removeCommandsBefore: true,
          },
        ],

        discordClientOptions: {
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMembers
          ],
        },
      }),
      inject: [ConfigService],
    }),
    BotModule,
    MongoModule.forRoot(process.env.MONGO_HOST, 'prod'),
  ],
  controllers: [UsersController, MissionsController, AppController],
  providers: [AppService],
})
export class AppModule {}
