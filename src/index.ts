import { Command } from 'commander';
import { registerSetup } from './commands/setup';
import { registerServe } from './commands/serve';
import { registerStop } from './commands/stop';
import { registerStatus } from './commands/status';
import { registerTranscribe } from './commands/transcribe';
import { registerTidy } from './commands/tidy';
import { registerExtractTasks } from './commands/extract-tasks';
import { registerModels } from './commands/models';
import { registerObsidianSetup } from './commands/obsidian-setup';

const program = new Command();

program
  .name('olt')
  .description('Obsidian local-AI toolkit: voice transcription + LLM note tidying')
  .version('0.3.0');

registerSetup(program);
registerServe(program);
registerStop(program);
registerStatus(program);
registerTranscribe(program);
registerTidy(program);
registerExtractTasks(program);
registerModels(program);
registerObsidianSetup(program);

program.parse(process.argv);
