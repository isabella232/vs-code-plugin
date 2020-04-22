import * as child_process from 'child_process';
import * as fs from "fs";
import * as path from 'path';
import commands from './commands';
import logger from '../utils/logger'


const { command, platform } = commands;

class ProcessService {
    public port: number;
    // private isSbFound: boolean;
    private rootDir: string;
    private fileName: string;
    private vscode;
    private statusText;
    private aesopEmitter;
    constructor({ rootDir, vscode, statusText, aesopEmitter }) {
        this.rootDir = rootDir;
        this.vscode = vscode;
        this.statusText = statusText;
        this.aesopEmitter = aesopEmitter;
        this.fileName = '@process.service.ts'
        this.startStorybook = this.startStorybook.bind(this);
        this.findLocation = this.findLocation.bind(this);
        this.locationViaNetStat = this.locationViaNetStat.bind(this);
    }

    //make location checks private methods that are referred to in a findLocation check

    public findLocation(pid) {
        logger.write('Attempting to find Storybook Location', this.fileName, 'findLocation')
        const processPid = parseInt(pid).toString();
        this.locationViaNetStat(processPid);
    }

    private locationViaNetStat(processPid) {
        logger.write('Attempting to locate via Netstat', this.fileName, 'locationViaNetstat')
        const netStatProcess = child_process.spawn(command.cmd, command.args);
        const grepProcess = child_process.spawn('grep', [processPid]);

        netStatProcess.stdout.pipe(grepProcess.stdin);
        grepProcess.stdout.setEncoding('utf8');

        grepProcess.once('killGrep', () => {
            console.log(`Killed Grep`);
            grepProcess.kill();
        });

        netStatProcess.once('killNet', () => {
            console.log(`Killed Net`);
            netStatProcess.kill();
        });

        netStatProcess.stdout.once('exit', (code) => {
            this.vscode.window.showInformationMessage(`Netstat ended with ${code}`);
        })

        grepProcess.stdout.once('exit', (code) => {
            this.vscode.window.showInformationMessage(`Grep ended with ${code}`);
        })


        grepProcess.stdout.on('data', (data) => {
            const parts = data.split(/\s/).filter(String);
            logger.write(`Getting data from grep process ${parts}`, this.fileName, 'locationViaNetstat/grepProcess')
            //@TODO: refactor for platform specific or grab port dynamically
            //Might be useful to use table-parser. idk if that works w/ windows tho
            
            const partIndex = (platform === 'win32') ? 1 : 3;
            this.port = parseInt(parts[partIndex].replace(/[^0-9]/g, ''));
            // aesopEmitter.emit('sb_on');
            this.aesopEmitter.emit('create_webview', this.port);
            logger.write(`Found Storybook location via Netstat`, this.fileName, 'locationViaNetstat/grepProcess');

            //do we need to remove 
            process.send('killNet');
            process.send('killGrep');
        })
    }

    //MAYBE separate this function?
    //possibly break it down as well into:
    //grab json script
    //start storybook

    startStorybook() {
        let data: Buffer;
        logger.write('Starting Storybook for you!', this.fileName, 'startStorybook')

        try {
            data = fs.readFileSync(path.join(this.rootDir, 'package.json'));
            logger.write('Obtained data from package.json', this.fileName, 'startStorybook');
        } catch (err) {
            this.vscode.window.showErrorMessage(`Aesop is attempting to read ${this.rootDir}. Is there a package.json file here?`);
            this.statusText.dispose();
            return false;
        }


        this.statusText.text = `Checking package.json...`;

        //enter the package.JSON file and retrieve its contents as an object
        let packageJSON = JSON.parse(data.toString());
        let storybookScript = packageJSON.scripts.storybook;

        //iterate through the text string (stored on "storybook" key) and parse out port flag
        //it is more helpful to split it into an array separated by whitespace to grab this
        let retrievedScriptArray = storybookScript.split(' ');

        //@TODO if script already includes --ci, no need to add it

        //older Windows systems support here: check platform, change process command accordingly


        const sbCLI = './node_modules/.bin/start-storybook'
        const sbStartIndex = retrievedScriptArray.indexOf('start-storybook')
        retrievedScriptArray[sbStartIndex] = sbCLI;
        retrievedScriptArray.push('--ci')

        //now launch the child process on the port you've derived
        const childProcessArguments = (platform === 'win32') ? ['run', 'storybook'] : retrievedScriptArray;
        const childProcessCommand = (platform === 'win32') ? 'npm.cmd' : 'node';

        const runSb = child_process.spawn(childProcessCommand, childProcessArguments, {cwd: this.rootDir, detached: true, env: process.env, windowsHide: false, windowsVerbatimArguments: true });

        // if (platform === 'win32') {
        // 	let runSb = child_process.spawn('npm.cmd', ['run', 'storybook'], {cwd: rootDir, detached: true, env: process.env, windowsHide: false, windowsVerbatimArguments: true });
        // } else {
        // 	let runSb =	child_process.spawn('node', retrievedScriptArray, {cwd: rootDir, detached: false, env: process.env });
        // }

        this.statusText.text = `Done looking. Aesop will now launch Storybook in the background.`;

        runSb.stdout.setEncoding('utf8');

        let counter = 0;

        //Storybook outputs three messages to the terminal as it spins up
        //grab the port from the last message to listen in on the process

        let callback = (data) => {
            let str = data.toString().split(" ");
            counter += 1;
            logger.write(`This is data: ${data.toString()}`, this.fileName, 'startStorybook/runSb')

            if (counter >= 2) {
                for (let i = 165; i < str.length; i += 1) {
                    if (str[i].includes('localhost')) {
                        const path = str[i];
                        const regExp = (/[^0-9]/g);
                        this.port = (path.replace(regExp, ""));

                        logger.write('Found instance in stdout that includes localhost', this.fileName, 'startStorybook/runSb')
                        this.aesopEmitter.emit('create_webview', this.port);
                        return true;
                    }
                }
            }
        };
        callback = callback.bind(this);


        runSb.stdout.on('data', callback)

        runSb.on('error', (err) => {
            console.log(err);
            process.exit(1);
        })

        //make sure the child process is terminated on process exit
        runSb.on('exit', (code) => {
            console.log(`child process exited with code ${code}`);
        })
    }
}


export default ProcessService;
