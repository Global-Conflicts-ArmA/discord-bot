import { DiscordClientProvider } from '@discord-nestjs/core';
import { Controller, Get, Param } from '@nestjs/common';
import { Routes } from 'discord.js';

@Controller('users')
export class UsersController {
  constructor(private readonly discordProvider: DiscordClientProvider) {}

  @Get()
  async findAll(): Promise<object> {
    const client = this.discordProvider.getClient();
    const guildId = process.env.DISCORD_SERVER_ID;

    // Use REST API (not Gateway cache) so global_name is always included
    const allRaw: any[] = [];
    let after: string | undefined;

    for (;;) {
      const query = new URLSearchParams({ limit: '1000' });
      if (after) query.set('after', after);

      const batch = (await client.rest.get(Routes.guildMembers(guildId), {
        query,
      })) as any[];

      allRaw.push(...batch);
      if (batch.length < 1000) break;
      after = batch[batch.length - 1].user.id;
    }

    return allRaw.map((raw: any) => ({
      userId: raw.user.id,
      username: raw.user.username,
      globalName: raw.user.global_name ?? null,
      nickname: raw.nick ?? null,
      displayName: raw.nick ?? raw.user.global_name ?? raw.user.username,
      displayAvatarURL: memberAvatarURL(
        guildId,
        raw.user.id,
        raw.avatar,
        raw.user.avatar,
      ),
    }));
  }

  @Get('/donators')
  async findDonators(): Promise<object> {
    const gcGuild = this.discordProvider
      .getClient()
      .guilds.cache.get(process.env.DISCORD_SERVER_ID);

    await gcGuild.roles.fetch();
    await gcGuild.members.fetch();

    const donatorRole = gcGuild.roles.cache.get(
      process.env.DISCORD_DONATOR_ROLE_ID,
    );

    return donatorRole.members;
  }

  @Get('/:id')
  async findUser(@Param() params): Promise<object> {
    const client = this.discordProvider.getClient();
    const guildId = process.env.DISCORD_SERVER_ID;
    const gcGuild = client.guilds.cache.get(guildId);

    await gcGuild.roles.fetch();

    // Use REST API directly so global_name is always present
    let raw: any;
    try {
      raw = await client.rest.get(Routes.guildMember(guildId, params.id));
    } catch {
      return {};
    }

    const roleIds: string[] = raw.roles ?? [];
    const rolesMap = roleIds
      .map((id) => gcGuild.roles.cache.get(id))
      .filter((role) => role && role.name !== '@everyone')
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
      }));

    return {
      userId: raw.user.id,
      username: raw.user.username,
      globalName: raw.user.global_name ?? null,
      nickname: raw.nick ?? null,
      displayName: raw.nick ?? raw.user.global_name ?? raw.user.username,
      displayAvatarURL: memberAvatarURL(
        guildId,
        raw.user.id,
        raw.avatar,
        raw.user.avatar,
      ),
      rolesMap,
    };
  }
}

function memberAvatarURL(
  guildId: string,
  userId: string,
  guildAvatar: string | null,
  userAvatar: string | null,
): string {
  if (guildAvatar) {
    const ext = guildAvatar.startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${guildAvatar}.${ext}`;
  }
  if (userAvatar) {
    const ext = userAvatar.startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/avatars/${userId}/${userAvatar}.${ext}`;
  }
  const index = parseInt(userId, 10) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
