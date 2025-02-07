import ILocale from './locale';

const locale: ILocale = {
  address: 'Address',
  arma3ServerName: 'ArmA 3 Operations Server',
  armaReforgerServerName: 'ArmA Reforger Operations Server',
  maintenanceMessages: {
    disabled: `I've disabled maintenance mode and I am polling the server once more!`,
    enabled: `I've enabled maintenance mode and will no longer poll the server!`,
  },
  map: 'Map',
  mission: 'Mission',
  noMap: 'No Mission Selected',
  noPermissions: `you don't have the permissions to do that!`,
  noPlayers: 'No players',
  pingMessage: 'player threshold has been reached on the server.',
  playerCount: 'Player count',
  playerList: 'Player list',
  presence: {
    botFailure: 'Connection Failure',
    error: 'Server Offline',
    maintenance: 'Maintenance',
    ok: 'Mission',
  },
  queryTime: 'Query Time',
  serverDownForMaintenance: 'Down for maintenance',
  serverDownForMaintenanceDescription:
    'The server is currently down for maintenance.',
  serverDownMessages: {
    pingMessage: ', server not responding',
    pleaseFixServer: ', server not responding',
    serverDownAlternative: 'server is down',
  },
  serverOffline: 'Server is offline',
  statuses: {
    offline: 'Offline',
    online: 'Online',
    status: 'Status',
  },
  tooManyPlayers: 'Too many players to display',
};

export default locale;
