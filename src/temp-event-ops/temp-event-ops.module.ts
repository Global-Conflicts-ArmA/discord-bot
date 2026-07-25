import { Module } from '@nestjs/common';
import { SheetsClientService } from './sheets-client.service';

// TEMPORARY module — see README.md in this directory.

@Module({
  providers: [SheetsClientService],
  exports: [SheetsClientService],
})
export class TempEventOpsModule {}
