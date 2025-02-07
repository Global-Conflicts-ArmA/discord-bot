import * as gamedig from 'gamedig';

export default class Server {
  public query?: gamedig.QueryResult;

  private ip: string;
  private port: number;
  private type: string;

  constructor(ip: string, port: number, type: string) {
    this.ip = ip;
    this.port = port;
    this.type = type;
  }

  public queryServer(): Promise<gamedig.QueryResult | undefined> {
    const dig = new gamedig.GameDig();

    return new Promise((resolve) => {
      dig
        .query({
          host: this.ip,
          port: this.port,
          type: this.type,
          givenPortOnly: true,
        })
        .then((query) => {
          this.query = query;
          resolve(query);
        })
        .catch((error) => {
          console.warn(error);
          resolve(undefined);
        });
    });
  }
}
