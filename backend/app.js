'use strict';

const express = require('express');
const app = express();

const server = require('http').Server(app);
const io = require('socket.io')(server);

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const azureCloudUrl = "http://localhost:8181";
const APP_KEY = "cNPu7ZXHrI30LgA__A0SX5U600IsOcMv3VpyFOjO68ixAzFuZygAUA==";

app.set('view engine', 'ejs');
app.use('/static', express.static('public'));

app.get('/', (req, res) => {
    res.render('client');
});

app.get('/display', (req, res) => {
    res.render('display');
});

function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

// Game Configuration
let maxGamePlayers = 8;
let minGamePlayers = 3;

// Application State
let appState = { gameState: 0, round: 0, roundState: 0 };

// Authentication
let usersPassCredentials = new Map();

// Prompt Management
let newPromptsCounter = 0;
let newPromptsInclUser = new Map();
let afterPromptsCounter = 0;
let afterPromptsInclUser = new Map();

// Submission Tracking
let submittedUsers = [];
let answersFromPrompts = new Map();
let promptAnswersCount = 0;

// Voting Management
let votesFromPrompts = new Map();
let votesCounted = 0;

// Player Management
let players = new Map();
let playerNameToSockets = new Map();
let socketsToPlayersName = new Map();
let admin = null;

// Audience Management
let audienceMembers = new Map();
let audienceMembersNameToSockets = new Map();
let socketsToaudienceMembersName = new Map();

// Display Settings
let display = null;
// Async function to handle user registration
async function handleRegister(socket, username, password) {
    console.log("Register Request Handling");

    try {
        // Sending registration request to the backend
        const response = await fetch(azureCloudUrl + "/player/register", {
            method: "POST",
            body: JSON.stringify({ "username": username, "password": password }),
            headers: { "Content-Type": "application/json", "x-functions-key": APP_KEY }
        });
        const json = await response.json();
        console.log("Backend response: " + JSON.stringify(json));

        // Emitting login response and adding user
        socket.emit("loginResp", { "username": username, "msg": json["msg"] });
        userAddition(json, socket, username, password);
    } catch (error) {
        console.error("Error While Registering:", error);
    }cd 
}

// Async function to handle user login
async function handleLogin(socket, username, password) {
    console.log(" Login Request Handling for:" + username + ":" + password);
    try {
        // Sending login request to the backend
        const response = await fetch(azureCloudUrl + "/player/login", {
            method: "POST",
            body: JSON.stringify({ "username": username, "password": password }),
            headers: { "Content-Type": "application/json", "x-functions-key": APP_KEY }
        });
        const json = await response.json();
        console.log("Backend response: " + JSON.stringify(json));

        // Emitting login response and adding user
        socket.emit("loginResp", { "username": username, "msg": json["msg"] });
        userAddition(json, socket, username, password);
    } catch (error) {
        console.error("Error during login:", error);
    }
}

// Function to add a user after successful registration or login
function userAddition(json, socket, username, password) {
    if (!json["result"]) return;

    // Assign admin role if no admin exists
    assignAdmin(username, socket);
    // Determine whether the user joins players or audience
    sortUserIntoGroup(username, socket);
    // Store user credentials
    storeCredentials(username, password);
    // Update all clients with the latest state
    updateAll();
}

// Function to assign admin role to a user
function assignAdmin(username, socket) {
    if (!admin) {
        admin = username;
        socket.emit("gotAnAdmin", true);
        if (display) {
            display.emit("adminCred", admin);
        }
    }
}

// Function to determine whether a user joins players or audience
function sortUserIntoGroup(username, socket) {
    const isGameFull = players.size >= maxGamePlayers;
    const isGameActive = appState.gameState === 1;
    const isVotingPhase = appState.gameState === 3;

    if (isGameFull || isGameActive) {
        // Join audience and send prompts if it's the voting phase
        joinAudience(username, socket);
        if (isVotingPhase) {
            pushPromptsToAudience(socket);
        }
    } else {
        // Join players
        joinPlayers(username, socket);
    }
}

// Function to add a user to the audience
function joinAudience(username, socket) {
    audienceMembers.set(username, { username, ScoreThisSession: 0, playerGameState: 2 });
    audienceMembersNameToSockets.set(username, socket);
    socketsToaudienceMembersName.set(socket, username);
    announce(`${username} joined the audience`);
}

// Function to add a user to the players
function joinPlayers(username, socket) {
    players.set(username, { username, ScoreThisSession: 0, playerGameState: 1 });
    playerNameToSockets.set(username, socket);
    socketsToPlayersName.set(socket, username);
    announce(`${username} joined the players`);
}

// Function to send prompts to a new audience member during the voting phase
function pushPromptsToAudience(socket) {
    answersFromPrompts.forEach((answersMap, promptOwner) => {
        answersMap.forEach((answers, prompt) => {
            socket.emit("answerToVoteOn", { prompt, promptOwner, answers: Object.fromEntries(answers) });
        });
    });
}

// Function to store user credentials
function storeCredentials(username, password) {
    usersPassCredentials.set(username, password);
}

// Function to handle admin commands
function handleAdmin(username, command) {
    console.log(`\nADMIN COMMAND: ${command}`);

    if (username !== admin) {
        console.log(`Admin action falied from player ${username} for ${command}`);
        return;
    }

    const commandActions = {
        "start": { condition: appState.gameState === 0, action: startGame },
        "advanceCurrentPhase": { condition: appState.gameState === 1, action: advanceCurrentPhase },
        "nextRound": { condition: appState.gameState === 1, action: nextRound },
        "endGame": { condition: appState.gameState === 1, action: endGame }
    };

    if (command in commandActions && commandActions[command].condition) {
        commandActions[command].action();
    } else {
        console.log(`Admin command unknown: ${command}`);
    }
}

// Function to start the game
function startGame() {
    const enoughPlayers = players.size >= minGamePlayers;
    const adminSocket = playerNameToSockets.get(admin);

    if (enoughPlayers) {
        console.log("Game Starting");
        announce("let the games begin");

        Object.assign(appState, { gameState: 1, round: 1, roundState: 1 });
        submittedUsers = [];
        updateAll();

        if (display) {
            display.emit("promptsNumUpdate", { count: 0, target: players.size + audienceMembers.size });
        }
    } else {
        adminSocket.emit("notEnoughPlayerForStart", "");
    }
}
// Function to advance to the next phase of the game
function advanceCurrentPhase() {
    console.log("Starting Next Phase");

    // Increment round state and update
    if (appState.roundState === 1) {
        appState.roundState++;
        updateAll();
        startAnswerPhase();
    } else if (appState.roundState === 2) {
        appState.roundState++;
        updateAll();
        startVotingPhase();
    } else if (appState.roundState === 3) {
        appState.roundState++;
        updateAll();
        startVotingResults();
    } else if (appState.roundState === 4) {
        appState.roundState++;
        updateAll();
        startShowTotalScores();
    } else if (appState.roundState === 5) {
        nextRound();
    }
}

// Async function to populate prompts for the game
async function countAllPrompts() {
    // Determine the target number of prompts based on game conditions
    let targettedSumOfPrompts = newPromptsCounter < players.size / 2 && players.size % 2 === 0 ? players.size / 2 : players.size;
    console.log(`Target population of Prompts is: ${targettedSumOfPrompts} newPromptsInclUser: ${newPromptsCounter}~`);

    // Clear past prompts and fetch new prompts
    afterPromptsInclUser.clear();
    await fetchAndAddPrompts(targettedSumOfPrompts);

    console.log(`Finished Prompts populating, afterPromptsInclUser: ${JSON.stringify([...afterPromptsInclUser.entries()])} Count: ${afterPromptsCounter}`);
    return targettedSumOfPrompts;
}

// Async function to fetch and add prompts to the game
async function fetchAndAddPrompts(targettedSumOfPrompts) {
    while (newPromptsCounter + afterPromptsCounter < targettedSumOfPrompts) {
        const promptsRequirred = targettedSumOfPrompts - newPromptsCounter - afterPromptsCounter;
        console.log(`Requesting additional Prompts from DataBase: ${promptsRequirred}`);
        const prompts = await fetchPrompts(promptsRequirred);
        addPromptsIfNotFound(prompts);
    }
}

// Async function to fetch prompts from the backend
async function fetchPrompts(promptsRequirred) {
    const response = await fetch(`${azureCloudUrl}/prompts/get`, { 
        method: 'POST',
        body: JSON.stringify({ prompts: promptsRequirred }),
        headers: { 'content-Type': 'application/json', 'x-functions-key': APP_KEY }
    });
    const prompts = await response.json();
    console.log(`BackEnd response: ${JSON.stringify(prompts)}`);
    return prompts;
}

// Function to add prompts if they are not found in the game
function addPromptsIfNotFound(prompts) {
    prompts.forEach(prompt => {
        console.log(`Trying to accept past prompt: ${JSON.stringify(prompt)}`);
        if (!isPromptFound(prompt)) {
            const userPrompts = afterPromptsInclUser.get(prompt.username) || [];
            userPrompts.push(prompt.text);
            afterPromptsInclUser.set(prompt.username, userPrompts);
            afterPromptsCounter++;
            console.log(`Prompt added to pastPrompts: ${JSON.stringify([...afterPromptsInclUser.entries()])}`);
        }
    });
}

// Function to check if a prompt is found in the game
function isPromptFound(prompt) {
    return newPromptsInclUser.get(prompt.username)?.includes(prompt.text) || afterPromptsInclUser.get(prompt.username)?.includes(prompt.text);
}

// Async function to start the answer phase of the game
async function startAnswerPhase() {
    console.log("\nStarting Answer Phase");

    // Populate prompts and update display
    const targettedSumOfPrompts = await countAllPrompts();
    updateDisplayWithAnswerCount(targettedSumOfPrompts);

    // Initialize player prompt list
    const promptListFromPNames = initializePlayerPromptList();
    console.log("\nAssigning Prompts To Players");

    // Assign prompts to players
    assignPromptsToPlayers(promptListFromPNames, newPromptsInclUser);
    assignPromptsToPlayers(promptListFromPNames, afterPromptsInclUser);

    // Display assigned prompts and send prompts to players
    displayAssignedPrompts(promptListFromPNames);
    sendPromptsToPlayers(promptListFromPNames);
}

// Function to update display with answer count
function updateDisplayWithAnswerCount(targettedSumOfPrompts) {
    if (display != null) {
        display.emit("answerNumUpdate", { count: 0, target: (afterPromptsCounter + newPromptsCounter) * 2 });
    }
}

// Function to initialize player prompt list
function initializePlayerPromptList() {
    const promptListFromPNames = new Map();
    for (const userName of players.keys()) {
        promptListFromPNames.set(userName, []);
    }
    return promptListFromPNames;
}

// Function to assign prompts to players
function assignPromptsToPlayers(promptListFromPNames, promptsWUser) {
    let totalPromptsAssigned = 0;
    promptsWUser.forEach((fPrompts, fPromptOwner) => {
        fPrompts.forEach(fPrompt => {
            console.log(`\n\nAssigning prompt: ${fPrompt} - By ${fPromptOwner}`);
            let promptAssignCount = 0;
            players.forEach((_, userName) => {
                const iOffset = (players.size + totalPromptsAssigned - promptAssignCount) % players.size;
                const assignee = Array.from(players.keys())[iOffset];
                if (promptAssignCount < 2 && promptListFromPNames.get(assignee).length < 2) {
                    console.log(`Prompt assigned to: ${assignee}`);
                    promptListFromPNames.get(assignee).push({ promptOwner: fPromptOwner, prompt: fPrompt });
                    promptAssignCount++;
                }
            });
            totalPromptsAssigned++;
        });
    });
}

// Function to display assigned prompts
function displayAssignedPrompts(promptListFromPNames) {
    console.log("Assigned All Prompts: ");
    promptListFromPNames.forEach((prompts, user) => {
        console.log(`User: ${user}`);
        prompts.forEach(({ prompt, promptOwner }) => {
            console.log(`prompt: ${prompt} - Prompt Owner: ${promptOwner}`);
        });
    });
}

// Function to send prompts to players
function sendPromptsToPlayers(promptListFromPNames) {
    console.log("\nSending Prompts to Players");
    promptListFromPNames.forEach((prompts, username) => {
        const socket = playerNameToSockets.get(username);
        prompts.forEach(({ prompt, promptOwner }) => {
            socket.emit("promptToAnswer", { prompt, promptOwner });
        });
    });
}
// Function to start the voting phase of the game
function startVotingPhase() {
    console.log("Starting Voting Stage");

    // Update the vote count display
    updateVoteCountDisplay();

    // Distribute prompts for voting to players and audience
    distributePromptsForVoting();

    console.log("All Answers Submitted to Players");
}

// Function to update the vote count display
function updateVoteCountDisplay() {
    if (display) {
        // Calculate the total votes based on game conditions
        const totalVotes = (promptAnswersCount / 2) + ((promptAnswersCount / 2) * audienceMembers.size);
        display.emit("votesNumUpdate", { count: 0, target: totalVotes });
    }
}

// Function to distribute prompts for voting to players and audience
function distributePromptsForVoting() {
    answersFromPrompts.forEach((prompts, promptOwner) => {
        prompts.forEach((answers, promptText) => {
            // Prepare data for the prompts to send to players and audience
            const answerData = { prompt: promptText, promptOwner, answers: Object.fromEntries(answers) };

            // Send prompts to players
            playerNameToSockets.forEach((socket, userName) => {
                if (!answers.has(userName)) {
                    socket.emit("answerToVoteOn", answerData);
                }
            });

            // Send prompts to audience
            audienceMembersNameToSockets.forEach((socket) => {
                socket.emit("answerToVoteOn", answerData);
            });
        });
    });
}

// Function to start the voting results phase of the game
function startVotingResults() {
    console.log("Starting Voting Scores Phase");

    let objects = [];

    // Process the voting results for each prompt
    votesFromPrompts.forEach((promptMap, promptOwner) => {
        promptMap.forEach((answerMap, prompt) => {
            let answerOwners = [];
            let answers = [];
            let voters = [];

            // Process the details of each answer for voting results
            processAnswerMap(answerMap, answerOwners, answers, voters, players, appState);

            // Create a voting result object for each prompt
            let votingResultObject = createVotingResultObject(promptOwner, prompt, answerOwners, answers, voters);
            objects.push(votingResultObject);
        });
    });

    console.log("Sending Voting Results");
    console.log(JSON.stringify(objects));

    // Emit the voting results to all clients
    io.emit("votingResults", objects);
}

// Function to process the details of each answer for voting results
function processAnswerMap(answerMap, answerOwners, answers, voters, players, appState) {
    answerMap.forEach((details, answerOwner) => {
        answerOwners.push(answerOwner);
        answers.push(details.get("answer"));
        voters.push(details.get("voters"));

        // Update scores for each player based on voting
        players.get(answerOwner).ScoreThisSession += appState.round * 100 * details.get("voters").length;
        console.log(`Updated Scores for: ${answerOwner} : ${JSON.stringify(players.get(answerOwner))}`);
    });
}

// Function to create a voting result object for a prompt
function createVotingResultObject(promptOwner, prompt, answerOwners, answers, voters) {
    return {
        promptOwner: promptOwner,
        prompt: prompt,
        answerOwner1: answerOwners[0],
        answer1: answers[0],
        voters1: voters[0],
        answerOwner2: answerOwners[1],
        answer2: answers[1],
        voters2: voters[1]
    };
}

// Function to start the total scores phase of the game
function startShowTotalScores(){
    console.log("Starting Total Scores Phase")
    // Emit a message to all clients to indicate the start of total scores phase
    io.emit("totalScores", "")
}

// Function to move to the next round of the game
function nextRound(){
    console.log("Starting New Round!!")

    // Increment the round and reset round data
    incrementRound();
    resetRoundData();

    // Update all game data and display
    updateAll();
    updateDisplayWithPromptCount();
}

// Function to increment the round of the game
function incrementRound() {
    appState.round++;
    appState.roundState = 1;
}

// Function to update the display with the total prompt count
function updateDisplayWithPromptCount() {
    if (display) {
        const promptCount = players.size + audienceMembers.size;
        display.emit("promptsNumUpdate", { count: 0, target: promptCount });
    }
}

// Function to reset data for a new round
function resetRoundData(){
    afterPromptsInclUser.clear()
    afterPromptsCounter = 0

    newPromptsInclUser.clear()
    newPromptsCounter = 0

    submittedUsers.length = 0;
    promptAnswersCount = 0

    answersFromPrompts.clear()
    votesFromPrompts.clear()
    votesCounted = 0
}

// Function to handle the end of the game
function endGame() {
    console.log("Function to end game");
    // Set game and round states, reset round data, and update players backend
    setGameAndRoundStates();
    resetRoundData();
    updatePlayersBackend();
    updateAll();
}

// Function to set the game and round states
function setGameAndRoundStates() {
    appState.gameState = 0;
    appState.roundState = 0;
}

// Function to update the backend scores and games played for players
function updatePlayersBackend() {
    players.forEach(updatePlayerScoreAndGames);
}

// Function to update scores and games played for a player
function updatePlayerScoreAndGames([username, obj]) {
    console.log(`Updating scores and games for: ${username} Adding Score: ${obj.ScoreThisSession}`);
    const playerData = {
        "username": username,
        "password": usersPassCredentials.get(username),
        "add_to_score": obj.ScoreThisSession,
        "add_to_games_played": 1
    };

    // Update backend with player data
    fetch(azureCloudUrl + "/player/update", {
        method: "POST",
        body: JSON.stringify(playerData),
        headers: {
            "content-Type": "application/json",
            "x-functions-key": APP_KEY
        }
    })
    .then(response => response.json())
    .then(json => console.log(`BackEnd resp: ${JSON.stringify(json)}`));
}
// Function to handle chat messages and broadcast to all clients
function handleChat(message) {
    console.log('Handling chat: ' + message); 
    io.emit('chat', message);
}

// Function to handle announcements and broadcast to all clients
function announce(message){
    console.log("Announcement: " + message);
    io.emit("chat", message);
}

// Function to update all game data
function updateAll(){
    updatePlayers();
    updateAudiences();
    updateDisplay();
}

// Function to update the display with game state information
function updateDisplay() {
    console.log(display ? "Updating Display" : "No Display to update");
    if (display) {
        const data = {
            appState: appState,
            players: Object.fromEntries(players),
            audienceMembers: Object.fromEntries(audienceMembers)
        };
        emitDisplayData(data);
    }
}

// Function to emit display data to the display client
function emitDisplayData(data) {
    display.emit("state", data);
    display.emit("adminCred", admin);
}

// Function to update all player clients
function updatePlayers(){
    console.log("Updating all players");
    for( let [userName, socket] of playerNameToSockets){
        updatePlayer(socket);
    }
}

// Function to update all audience clients
function updateAudiences(){
    console.log("Updating all Audiences");
    for( let [userName, socket] of audienceMembersNameToSockets){
        updateAudience(socket);
    }
}

// Function to update a specific audience client
function updateAudience(socket=null){
    const userName = socketsToaudienceMembersName.get(socket)
    const thePlayer = audienceMembers.get(userName);
    const data = { appState: appState, me: thePlayer, players: Object.fromEntries(players), audienceMembers: Object.fromEntries(audienceMembers)};
    socket.emit("state", data);
}

// Function to update a specific player client
function updatePlayer(socket=null){
    const userName = socketsToPlayersName.get(socket)
    const thePlayer = players.get(userName);
    const data = { appState: appState, me: thePlayer, players: Object.fromEntries(players), audienceMembers: Object.fromEntries(audienceMembers)};
    socket.emit("state", data);
}

// Function to handle a submitted prompt
function handlePrompt(socket, username, prompt) {
    console.log(`Handling Submitted Prompt: ${prompt}: From: ${username}`);

    // Check if the user has already submitted a prompt for this round
    if (!submittedUsers.includes(username)) {
        submitPrompt(username, prompt, socket); // Pass the socket to the submitPrompt function
    }
}

// Function to submit a prompt to the backend
function submitPrompt(username, prompt, socket) {
    const promptData = {
        "username": username,
        "password": usersPassCredentials.get(username),
        "text": prompt
    };

    // Submit prompt data to the backend
    fetch(azureCloudUrl + "/prompt/create", {
        method: "POST",
        body: JSON.stringify(promptData),
        headers: {
            "content-Type": "application/json",
            "x-functions-key": APP_KEY
        }
    })
    .then(response => response.json())
    .then(json => {
        handleBackendResponse(json, username, prompt);
        processSubmissionResponse(socket, username, json);
    });
}

// Function to handle the backend response for prompt submission
function handleBackendResponse(json, username, prompt) {
    console.log(`BackEnd resp: ${JSON.stringify(json)}`);
    if (json["result"]) {
        addPromptToUser(username, prompt);
        newPromptsCounter++;
        updateDisplayWithPromptCount();
        checkForadvanceCurrentPhase();
    }
}

// Function to add a prompt to the user's submitted prompts
function addPromptToUser(username, prompt) {
    if (!newPromptsInclUser.has(username)) {
        newPromptsInclUser.set(username, []);
    }
    newPromptsInclUser.get(username).push(prompt);
    submittedUsers.push(username);
}

// Function to update the display with the current prompt count
function updateDisplayWithPromptCount() {
    if (display) {
        display.emit("promptsNumUpdate", {
            count: newPromptsCounter,
            target: players.size + audienceMembers.size
        });
    }
}

// Function to check if the next phase of the game should start
function checkForadvanceCurrentPhase() {
    if (newPromptsCounter === players.size + audienceMembers.size) {
        advanceCurrentPhase();
    }
}

// Function to process the submission response and emit it to the client
function processSubmissionResponse(socket, username, json) {
    socket.emit("promptResp", {
        "username": username,
        "msg": json["msg"]
    });
}

// Function to handle a prompt answer from a player
function handlePromptAnswer(socket, username, prompt, promptOwner, answer) {
    console.log(`\nPrompt Answer Received: ${answer} From Player: ${username} For prompt: ${prompt}`);

    if (!answersFromPrompts.has(promptOwner)) {
        answersFromPrompts.set(promptOwner, new Map());
    }

    if (!answersFromPrompts.get(promptOwner).has(prompt)) {
        answersFromPrompts.get(promptOwner).set(prompt, new Map());
    }

    answersFromPrompts.get(promptOwner).get(prompt).set(username, answer);
    promptAnswersCount++;

    let answerCountTarget = (afterPromptsCounter + newPromptsCounter) * 2;

    console.log(`Check Answer stored correctly: ${answersFromPrompts.get(promptOwner).get(prompt).get(username)}`);
    console.log(`Current received answer is: ${promptAnswersCount} Target is: ${answerCountTarget}`);

    initializeVotingMap(promptOwner, prompt, username, answer);

    updateDisplayWithAnswerCount();

    if (promptAnswersCount === answerCountTarget) {
        advanceCurrentPhase();
    }
}

// Function to initialize the voting map for a prompt answer
function initializeVotingMap(promptOwner, prompt, answerOwner, answer) {
    let ownerMap = votesFromPrompts.get(promptOwner) || new Map();
    votesFromPrompts.set(promptOwner, ownerMap);

    let promptMap = ownerMap.get(prompt) || new Map();
    ownerMap.set(prompt, promptMap);

    let answerMap = promptMap.get(answerOwner) || new Map();
    promptMap.set(answerOwner, answerMap);

    answerMap.set("answer", answer);
    answerMap.set("voters", []);
}

// Function to update the display with the current answer count
function updateDisplayWithAnswerCount() {
    if (display) {
        display.emit("answerNumUpdate", { count: promptAnswersCount, target: (afterPromptsCounter + newPromptsCounter) * 2 });
    }
}

function handleAnswerVote(socket, voterUsername, prompt, promptOwner, answer) {
    const answerOwner = answer.username;
    const answerText = answer.answer;

    console.log(`Received vote from player: ${voterUsername} For answer: ${answerText} From: ${answerOwner}`);

    const answerOwnerMap = votesFromPrompts.get(promptOwner)?.get(prompt)?.get(answerOwner);

    if (answerOwnerMap?.get("answer") === answerText) {
        answerOwnerMap.get("voters").push(voterUsername);
    } else {
        throw new Error('Vote is invalid or answer not found.');
    }

    console.log(`Vote Stored Properly Check: ${answerOwnerMap.get("voters")}`);

    votesCounted++;
    const votesTarget = (promptAnswersCount / 2) + ((promptAnswersCount / 2) * audienceMembers.size);
    console.log(`Votes collected: ${votesCounted} Target is: ${votesTarget}`);

    updateDisplayWithVoteCount(display, votesCounted, votesTarget);

    if (votesCounted === votesTarget) {
        advanceCurrentPhase();
    }
}
// Function to update the display with the current vote count
function updateDisplayWithVoteCount(display, votesCounted, votesTarget) {
    if (display) {
        display.emit("votesNumUpdate", { count: votesCounted, target: votesTarget });
    }
}

// Handle new connection
io.on('connection', socket => { 
    console.log('New connection');

    // Handle chat messages
    socket.on('chat', message => {
        handleChat(message);
    });

    // Handle user registration
    socket.on('register', message => {
        let userName = message.substring(0, message.indexOf(" "));
        let password = message.substring(message.indexOf(" ") + 1);
        handleRegister(socket, userName, password);
    });

    // Handle user login
    socket.on('login', message => {
        let userName = message.substring(0, message.indexOf(" "));
        let password = message.substring(message.indexOf(" ") + 1);
        handleLogin(socket, userName, password);
    });

    // Handle display connection
    socket.on("display", message => {
        display = socket;
        console.log("Display connected -> Updating");
        updateDisplay();
    });

    // Handle admin messages
    socket.on('admin', command => {
        if (!socketsToPlayersName.has(socket)) return;
        handleAdmin(socketsToPlayersName.get(socket), command);
    });

    // Handle prompt submissions
    socket.on('prompt', prompt => {
        if (socketsToPlayersName.has(socket) && appState.gameState === 1 && appState.roundState === 1) {
            handlePrompt(socket, socketsToPlayersName.get(socket), prompt);
        } else if (socketsToaudienceMembersName.has(socket) && appState.gameState === 1 && appState.roundState === 1) {
            handlePrompt(socket, socketsToaudienceMembersName.get(socket), prompt);
        }
    });

    // Handle prompt answers
    socket.on('promptAnswer', (data) => {
        if (appState.gameState === 1 && appState.roundState === 2) {
            const playerName = socketsToPlayersName.get(socket);
            if (playerName) {
                handlePromptAnswer(socket, playerName, data.prompt, data.promptOwner, data.answer);
            }
        } else {
            console.log("ERROR6830");
        }
    });

    // Handle answer votes
    socket.on('answerVote', json => {
        if (socketsToPlayersName.has(socket) && appState.gameState === 1 && appState.roundState === 3) {
            handleAnswerVote(socket, socketsToPlayersName.get(socket), json.prompt, json.promptOwner, json.answer);
        } else if (socketsToaudienceMembersName.has(socket) && appState.gameState === 1 && appState.roundState === 3) {
            handleAnswerVote(socket, socketsToaudienceMembersName.get(socket), json.prompt, json.promptOwner, json.answer);
        }
    });

    // Handle next phase or round
    socket.on('next', message => {
        if (socketsToPlayersName.has(socket)) {
            if (socketsToPlayersName.get(socket).username === admin) {
                handleAnswerVote(socketsToPlayersName.get(socket), ans);
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        let username = socketsToPlayersName.get(socket) || socketsToaudienceMembersName.get(socket);
    
        if (username) {
            if (socketsToPlayersName.has(socket)) {
                // Remove player data on disconnection
                players.delete(username);
                playerNameToSockets.delete(username);
                socketsToPlayersName.delete(socket);
    
                if (admin === username) {
                    // Assign new admin if the current admin disconnects
                    admin = players.keys().next().value;
                    console.log("New admin is: " + admin);
    
                    if (!admin) {
                        endGame();
                    } else {
                        playerNameToSockets.get(admin).emit("gotAnAdmin", true);
                        display?.emit("adminCred", admin);
                    }
                }
            } else {
                // Remove audience member data on disconnection
                audienceMembers.delete(username);
                audienceMembersNameToSockets.delete(username);
                socketsToaudienceMembersName.delete(socket);
            }
        }
    
        console.log(username + ' dropped connection');
    });
});

// Start server
if (module === require.main) {
    startServer();
}

module.exports = server;
