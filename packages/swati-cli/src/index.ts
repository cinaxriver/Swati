#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('swati')
  .description('Choreographic language for multi-agent AI workflows')
  .version('1.0.0');

program.command('init')
  .description('Initialize a new swati project')
  .action(() => {
    console.log(chalk.green('Initialized new swati project'));
  });

program.command('run')
  .description('Run a choreography')
  .action(() => {
    console.log(chalk.blue('Running choreography...'));
  });

program.parse();
