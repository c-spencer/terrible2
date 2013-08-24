var opti = require('optimist')
          .options('c', {
            alias: 'compile',
            default: false,
            boolean: true,
            describe: 'Compile target namespace'
          })
          .options('m', {
            alias: 'mode',
            default: 'library',
            describe: 'Compilation mode: library | standalone'
          })
          .options('h', {
            alias: 'help',
            default: false,
            boolean: true,
            describe: 'Show this help'
          })
          .options('e', {
            alias: 'entry-point',
            default: '-main',
            describe: 'Method run in the target namespace to start. ' +
                      'Either run when not compiling, or appended in standalone mode.'
          }),
    argv = opti.argv;

if (argv.help) {
  opti.showHelp();
  return;
}

var Environment = require(__dirname + '/stage0/environment').Environment;

var env = new Environment("node", false);

env.loadNamespace(argv._[0]);

if (argv.compile) {
  console.log(env.asJS(argv.mode, argv['entry-point']));
} else {
  console.log(env.runMethod(argv['entry-point'], argv._.slice(1)));
}
