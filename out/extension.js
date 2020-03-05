"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const url_1 = require("url");
const path = require("path");
const fs = require("fs");
const ps = require("ps-node");
const child_process = require("child_process");
const events = require("events");
const os = require("os");
function activate(context) {
    // let panel : vscode.WebviewPanel | undefined = undefined;
    //define PORT and host variables to feed the webview content from SB server
    let PORT;
    let host = 'localhost';
    const aesopEmitter = new events.EventEmitter();
    // let emittedAesop = false;
    const platform = os.platform();
    const commands = {
        linux: {
            cmd: 'netstat',
            args: ['-apntu'],
        },
        darwin: {
            cmd: 'netstat',
            args: ['-v', '-n', '-p', 'tcp'],
        },
        win32: {
            cmd: 'netstat.exe',
            args: ['-a', '-n', '-o'],
        },
    };
    const command = commands[platform];
    //@TODO: if aesop already opened sb in webview - subsequent calls to aesop should not open a new webview
    //set context "aesop-awake" to true; enabling views
    vscode.commands.executeCommand("setContext", "aesop-awake", true);
    //create the status bar to let the user know what Aesop is doing
    const statusText = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 7);
    statusText.text = "Aesop is finding your Storybook dependency...";
    statusText.color = "#FFFFFF";
    statusText.command = undefined;
    statusText.tooltip = "Aesop status";
    //create disposable to register Aesop Awaken command to subscriptions
    let disposable = vscode.commands.registerCommand('extension.aesopAwaken', () => {
        function createAesop(PORT, host) {
            statusText.hide();
            vscode.window.showInformationMessage(`Welcome to Aesop Storybook`);
            let panel = vscode.window.createWebviewPanel('aesop-sb', 'Aesop', vscode.ViewColumn.Beside, {
                enableCommandUris: true,
                enableScripts: true,
                portMapping: [{
                        webviewPort: PORT,
                        extensionHostPort: PORT
                    }],
                localResourceRoots: [vscode.Uri.file(context.extensionPath)],
            });
            panel.webview.onDidReceiveMessage((message) => {
                fs.appendFileSync(path.resolve(rootDir, './YOLO.txt'), (message.type, 'and here is the event itself\n', message.data, message));
            });
            panel.onDidDispose((e) => {
                panel = undefined;
            }, undefined, context.subscriptions);
            panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Aesop</title>
					<style>
						html { width: 100%; height: 100%; min-width: 20%; min-height: 20%;}
						body { display: flex; flex-flow: column nowrap; padding: 0; margin: 0; width: 100%' justify-content: center}
					</style>
				</head>
				<body>
        <script>
        
          (function(){
            if ('serviceWorker' in navigator){
              console.log('Service worker supported.');
            }

						const vscode = acquireVsCodeApi();
						const currentState = vscode.getState() || { value: 0 };

						window.addEventListener('message', event => {
							console.log("message received in external script: ", event);
							vscode.postMessage({
								type: 'manager_event',
								data: event
							});
						});
          }())
            
					</script>

					<iframe src="http://${host}:${PORT}" width="100%" height="700">
					<script>
						const vscode = acquireVsCodeApi();
						const currentState = vscode.getState() || { value: 0 };

						window.addEventListener('message', event => {
							console.log("message received in IFRAME script: ", event);
							vscode.postMessage({
								type: 'manager_event',
								data: event
							});
						});
					</script>
					
					</iframe>
				</body>
      </html>`;
        }
        ; //close createAesopHelper
        aesopEmitter.on('sb_on', () => {
            return createAesop(PORT, host);
        });
        statusText.show();
        //declare variable to toggle whether a running SB process was found
        let foundSb = false;
        //define a path to the user's root working directory
        const rootDir = url_1.fileURLToPath(vscode.workspace.workspaceFolders[0].uri.toString(true));
        //first test whether Storybook has been depended into your application
        fs.access(path.join(rootDir, '/node_modules/@storybook'), (err) => {
            //if the filepath isn't found, show the user what Aesop is reading as the root path
            if (err) {
                vscode.window.showErrorMessage(`Aesop could not find Storybook as a dependency in the active folder, ${rootDir}`);
                throw new Error('Error finding a storybook project');
            }
            else {
                statusText.text = "Aesop found a Storybook project.";
                //check to see if a storybook node process is already running
                ps.lookup({ command: 'node',
                    psargs: 'ux'
                }, (err, resultList) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Failed looking for running Node processes. Error: ${err}`);
                        statusText.dispose();
                        throw new Error('Failed looking for running Node processes.');
                    }
                    else {
                        //notify the user that Aesop is checking for a running Storybook instances
                        statusText.text = `Reviewing Node processes...`;
                        //if the process lookup was able to find running processes, iterate through to review them
                        resultList.forEach((nodeProcess) => {
                            //check if any running processes are Storybook processes
                            //stretch feature: check for multiple instances of storybook and reconcile
                            if (nodeProcess.arguments[0].includes('node_modules') && nodeProcess.arguments[0].includes('storybook')) {
                                vscode.window.showInformationMessage('Line 88');
                                //if so, extract port number and use that value to populate the webview with that contents
                                const pFlagIndex = nodeProcess.arguments.indexOf('-p');
                                //also grab the process id to use netstat in the else condition
                                const processPid = parseInt(nodeProcess['pid']).toString();
                                //if a port flag has been defined in the process args, retrieve the user's config
                                if (pFlagIndex !== -1) {
                                    PORT = parseInt(nodeProcess.arguments[pFlagIndex + 1]);
                                    aesopEmitter.emit('sb_on');
                                    // return;
                                }
                                else {
                                    vscode.window.showInformationMessage('Line 101');
                                    //if no port flag defined, dynamically retrieve port with netstat
                                    const netStatProcess = child_process.spawn(command.cmd, command.args);
                                    const grepProcess = child_process.spawn('grep', [processPid]);
                                    netStatProcess.stdout.pipe(grepProcess.stdin);
                                    grepProcess.stdout.setEncoding('utf8');
                                    grepProcess.stdout.on('data', (data) => {
                                        const parts = data.split(/\s/).filter(String);
                                        //@TODO: refactor for platform specific or grab port dynamically
                                        const partIndex = (platform === 'win32') ? 1 : 3;
                                        // console.log(parts)
                                        PORT = parseInt(parts[partIndex].replace(/[^0-9]/g, ''));
                                        aesopEmitter.emit('sb_on');
                                        vscode.window.showInformationMessage('Line 115');
                                        // return;
                                    });
                                    process.on('message', (message) => {
                                        switch (message.type) {
                                            case 'killNet':
                                                netStatProcess.kill();
                                                break;
                                            case 'killGrep':
                                                grepProcess.kill();
                                                break;
                                            default:
                                                console.log(message);
                                        }
                                    });
                                    netStatProcess.stdout.on('exit', (code) => {
                                        vscode.window.showInformationMessage(`Netstat ended with ${code}`);
                                    });
                                    grepProcess.stdout.on('exit', (code) => {
                                        vscode.window.showInformationMessage(`Grep ended with ${code}`);
                                    });
                                    process.send('killNet');
                                    process.send('killGrep');
                                }
                                //set foundSb to true to prevent our function from running another process
                                foundSb = true;
                                //once port is known, fire event emitter to instantiate webview
                                statusText.text = `Retrieving running Storybook process...`;
                            } //---> close if process.arguments[0] contains storybook
                        }); //---> close resultList.forEach()
                        //having checked running Node processes, set that variable to true
                        //if no processes matched 'storybook', we will have to spin up the storybook server
                        if (foundSb === false) {
                            vscode.window.showInformationMessage('Line 156');
                            //starts by checking for/extracting any port flags from the SB script in the package.json
                            fs.readFile(path.join(rootDir, 'package.json'), (err, data) => {
                                if (err) {
                                    vscode.window.showErrorMessage(`Aesop is attempting to read ${rootDir}. Is there a package.json file here?`);
                                    statusText.dispose();
                                }
                                else {
                                    statusText.text = `Checking package.json...`;
                                    //enter the package.JSON file and retrieve its contents as an object
                                    let packageJSON = JSON.parse(data.toString());
                                    let storybookScript = packageJSON.scripts.storybook;
                                    //iterate through the text string (stored on "storybook" key) and parse out port flag
                                    //it is more helpful to split it into an array separated by whitespace to grab this
                                    let retrievedScriptArray = storybookScript.split(' ');
                                    //@TODO if script already includes --ci, no need to add it
                                    //older Windows systems support here: check platform, change process command accordingly
                                    let platform = os.platform();
                                    const sbCLI = './node_modules/.bin/start-storybook';
                                    const sbStartIndex = retrievedScriptArray.indexOf('start-storybook');
                                    retrievedScriptArray[sbStartIndex] = sbCLI;
                                    retrievedScriptArray.push('--ci');
                                    //now launch the child process on the port you've derived
                                    const childProcessArguments = (platform === 'win32') ? ['run', 'storybook'] : retrievedScriptArray;
                                    const childProcessCommand = (platform === 'win32') ? 'npm.cmd' : 'node';
                                    const runSb = child_process.spawn(childProcessCommand, childProcessArguments, { cwd: rootDir, detached: true, env: process.env, windowsHide: false, windowsVerbatimArguments: true });
                                    statusText.text = `Done looking. Aesop will now launch Storybook in the background.`;
                                    runSb.stdout.setEncoding('utf8');
                                    let counter = 0;
                                    //Storybook outputs three messages to the terminal as it spins up
                                    //grab the port from the last message to listen in on the process
                                    runSb.stdout.on('data', (data) => {
                                        // if (emittedAesop === true) return;
                                        let str = data.toString().split(" ");
                                        counter += 1;
                                        vscode.window.showInformationMessage(`Line 201 - runSb counter = ${counter}`);
                                        if (counter >= 2) {
                                            vscode.window.showInformationMessage('Line 203 - inside counter');
                                            for (let i = 165; i < str.length; i += 1) {
                                                if (str[i].includes('localhost')) {
                                                    const path = str[i];
                                                    const regExp = (/[^0-9]/g);
                                                    PORT = (path.replace(regExp, ""));
                                                    // emittedAesop = true;
                                                    aesopEmitter.emit('sb_on');
                                                    vscode.window.showInformationMessage('Line 210');
                                                    // return;
                                                }
                                            }
                                        }
                                    });
                                    runSb.on('error', (err) => {
                                        console.log(err);
                                        process.exit(1);
                                    });
                                    //make sure the child process is terminated on process exit
                                    runSb.on('exit', (code) => {
                                        console.log(`child process exited with code ${code}`);
                                    });
                                }
                            });
                        } //close spin up server
                    }
                    ; //CLOSE else psLookup
                }); //close ps LOOKUP //close depend found, not checked processes
            } //close else statement in fs.access
        }); //close fs access
    }); //close disposable
    context.subscriptions.push(disposable);
}
exports.activate = activate;
function deactivate() {
    process.exit();
}
exports.deactivate = deactivate;
//line 101, 88, 115
//# sourceMappingURL=extension.js.map