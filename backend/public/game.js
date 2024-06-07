var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    
    data: {
        // Connection and User Info
        connected: false,
        amlogged: false,
        username: null,
        gotAnAdmin: false,

        // Game State
        promptSubmissionAccepted: false,
        queueOfPromptsToAnswer: [], // Current prompt is 1st in queue
        queueFromAnsToVotes: [], // Current prompt is 1st in queue
        messages: [],
        chatmessage: '',

        // Round State
        appState: {
            gameState: 0,
            round: 1,
            roundState: 0
        },
        
        me: null, // Players = {username, ScoreThisSession, playerGameState}
        players: null,
        audience: null,
        amAudience: false,
        waitAdvancingPhase: false,
        waitFromAnswersToPrompts: true,
        waitFromVotesToAnswers: true,
        answerOrder: [],
        voteResults: null,
    },
    mounted: function() {
        connect(); 
    },
    methods: {// Method to handle incoming chat messages
        handleChat(message) {
            // Limit chat messages to 10; remove the oldest message if the limit is reached
            if (this.messages.length + 1 > 10) {
                this.messages.pop();
            }
            // Add the new message to the beginning of the messages array
            this.messages.unshift(message);
        },
        
        // Method to handle the response from a login attempt
        handleLoginResponse(response) {
            console.log("Processing Login Response: " + JSON.stringify(response));
            document.getElementById('logInError').textContent = response.msg;
        
            const usernameInput = document.getElementById('loginUsername');
            const passwordInput = document.getElementById('loginPassword');
        
            // Handle different response messages
            switch (response.msg) {
                case "OK":
                    app.amlogged = true;
                    app.username = response.username;
                    break;
                case "Username less than 4 characters":
                case "Username more than 16 characters":
                case "Username already exists":
                    usernameInput.value = "";
                    break;
                case "Username or password incorrect":
                    usernameInput.value = "";
                    break;
                default:
                    break;
            }
            // Clear the password field in all cases
            passwordInput.value = "";
        },
        
        // Method to handle the response from submitting a prompt
        handlePromptResponse(message) {
            console.log(`Handling prompt Resp: ${JSON.stringify(message)}`);
            document.getElementById('promptSubmitError').textContent = message.msg;
            app.promptSubmissionAccepted = !(message.msg === "OK");
        },
        
        // Method to handle receiving a prompt to answer
        handleAnswerFromPrompt(receivedPrompt, promptOwner) {
            if (app.appState.gameState === 1 && app.appState.roundState === 2) {
                console.log("Answer from prompt received: " + JSON.stringify(receivedPrompt));
        
                app.waitFromAnswersToPrompts = false;
        
                if (app.queueOfPromptsToAnswer.length === 0) {
                    document.getElementById("prompt").textContent = "Prompt: " + receivedPrompt;
                    document.getElementById("promptOwner").textContent = "Created By - " + promptOwner;
        
                    console.log("Prompt displayed on screen");
                } else {
                    console.log("Prompt added to queue");
                }
        
                app.queueOfPromptsToAnswer.push({ prompt: receivedPrompt, promptOwner: promptOwner });
            } else {
                console.log("Client is not ready to receive prompts: " + app.appState.roundState);
                throw new Error("Client not ready");
            }
        },
        
        // Method to handle receiving answers to vote on
        handleVottedAnswer(receivedPrompt, promptCreator, pairOfAnswers) {
            app.waitFromVotesToAnswers = false;
        
            if (app.appState.gameState === 1 && app.appState.roundState === 3) {
                console.log("Answers Preparation for Votes");
        
                const answerMap = new Map(Object.entries(pairOfAnswers));
                console.log("Map Conversion Result: ", answerMap);
        
                if (app.queueFromAnsToVotes.length === 0) {
                    app.answerOrder = Array.from(answerMap.keys());
                    console.log("Answer Order: ", app.answerOrder);
        
                    document.getElementById('promptToVote').textContent = "Prompt: " + receivedPrompt;
                    document.getElementById('promptToVoteOwner').textContent = "By - " + promptCreator;
                    document.getElementById('leftPromptAnswer').textContent = answerMap.get(app.answerOrder[0]);
                    document.getElementById('rightPromptAnswer').textContent = answerMap.get(app.answerOrder[1]);
        
                    console.log("Answers are now displayed on the screen");
                } else {
                    console.log("Added Prompt to the Queue");
                }
        
                app.queueFromAnsToVotes.push({ prompt: receivedPrompt, promptOwner: promptCreator, answersObj: pairOfAnswers });
        
                console.log("Queue of current answers: ", JSON.stringify(app.queueFromAnsToVotes));
            } else {
                console.log("Client is not ready to vote: ", app.appState.roundState);
                throw new Error("Client not ready for voting");
            }
        },
        
        // Method to handle total scores display
        handleTotalScores() {
            if (app.appState.round === 3 && app.appState.roundState === 5) {
                document.getElementById("lastRoundPrompt").textContent = "Scores will be updated at the end of the game";
            }
        },
        
        // Method to handle displaying vote results
        handleVoteResults(votesFromPromptsTemp) {
            console.log("Votes to displays received:");
        
            const votesFromPromptsMap = new Map(Object.entries(votesFromPromptsTemp));
            app.voteResults = votesFromPromptsMap;
        
            votesFromPromptsMap.forEach((obj) => {
                console.log(`${obj.promptOwner}:${obj.prompt}:${obj.answerOwner1}:${obj.answer1}:${obj.voters1}`);
                console.log(`${obj.promptOwner}:${obj.prompt}:${obj.answerOwner2}:${obj.answer2}:${obj.voters2}`);
            });
        
            console.log("Votes Displayed");
        },
        
        // Method to send a chat message
        chat() {
            console.log(`Sending Chat Message: ${this.chatmessage}`);
            socket.emit('chat', `${this.username}: ${this.chatmessage}`);
            this.chatmessage = '';
        },
        
        // Method to handle user registration
        register() {
            const username = document.getElementById('loginUsername').value;
            const password = document.getElementById('loginPassword').value;
        
            console.log(`Submitting Register Request for: ${username} : ${password}`);
        
            socket.emit("register", `${username} ${password}`);
        },
        
        // Method to handle user login
        login() {
            let username = document.getElementById('loginUsername').value
            let password = document.getElementById('loginPassword').value
        
            console.log(`Submitting Login Request for: ${username} : ${password}`);
            socket.emit("login", `${username} ${password}`);
        },
        
        // Method to start the game
        startGame() {
            document.getElementById("adminErrorPrompt").textContent = "";
            socket.emit("admin", "start");
        },
        
        // Method to proceed to the next game phase
        advanceCurrentPhase() {
            console.log("Next Phase Request Submitted")
            socket.emit("admin", "advanceCurrentPhase")
        },
        
        // Method to proceed to the next game round
        nextRound() {
            socket.emit("admin", "nextRound")
        },
        
        // Method to end the game
        endGame() {
            socket.emit("admin", "endGame")
        },
        
        // Method to submit a prompt
        submitPrompt() {
            if (app.promptSubmissionAccepted) {
                const promptText = document.getElementById('promptSubmit').value;
        
                console.log(`Submitting Prompt: ${promptText}`);
                socket.emit("prompt", promptText);
        
                document.getElementById("promptSubmit").value = "";
                document.getElementById("promptSubmitError").textContent = "";
            } else {
                document.getElementById('promptSubmitError').textContent = "No more prompts for this round";
            }
        },
        
        // Method to submit an answer
        submitAnswer() {
            const answerQueueObj = app.queueOfPromptsToAnswer.shift();
        
            if (!app.waitFromAnswersToPrompts) {
                this.processSubmission(answerQueueObj);
                this.updatePromptDisplay();
                this.clearInputFields();
            }
        },
        
        // Method to process prompt answer submission
        processSubmission(answerQueueObj) {
            if (answerQueueObj) {
                const answer = document.getElementById('answerSubmit').value;
                const { prompt, promptOwner} = answerQueueObj;
                console.log(`Submitting answer: ${answer} For prompt: ${prompt} -By: ${promptOwner}`);
                socket.emit('promptAnswer', { prompt, promptOwner, answer });
            }
        },// Method to update the prompt display based on the next prompt in the queue
        updatePromptDisplay() {
            if (app.queueOfPromptsToAnswer.length > 0) {
                const nextPrompt = app.queueOfPromptsToAnswer[0];
                document.getElementById('prompt').textContent = nextPrompt.prompt;
                document.getElementById('promptOwner').textContent = `Created By - ${nextPrompt.promptOwner}`;
            } else {
                console.log('Answered All Prompts');
                document.getElementById('prompt').textContent = '';
                document.getElementById('promptOwner').textContent = '';
                app.waitAdvancingPhase = true;
            }
        },
        
        // Method to clear input fields for answer submission
        clearInputFields() {
            document.getElementById('answerSubmit').value = '';
            document.getElementById('answerSubmitError').textContent = '';
        },
        
        // Method to submit a vote for a prompt answer
        submitVote() {
            const selectedVote = this.getSelectedVote();
            if (selectedVote === null) {
                this.displayVoteError("You must select the prompt answer you like best");
                return;
            }
        
            const voteQueueObj = app.queueFromAnsToVotes.shift();
            if (!voteQueueObj) {
                console.error("ERROR85920");
                return;
            }
        
            this.processVoteSubmission(voteQueueObj, selectedVote);
            this.displayNextVote();
        },
        
        // Method to determine the selected vote (left or right)
        getSelectedVote() {
            const leftVote = document.getElementById('leftVote').checked;
            const rightVote = document.getElementById('rightVote').checked;
            if (leftVote) return 0;
            if (rightVote) return 1;
            return null;
        },
        
        // Method to display an error message for vote submission
        displayVoteError(message) {
            document.getElementById('voteSubmitError').innerHTML = message;
        },
        
        // Method to process the submission of a vote for a prompt answer
        processVoteSubmission(voteQueueObj, selectedVote) {
            const answers = new Map(Object.entries(voteQueueObj.answersObj));
            const answerJSON = {
                username: app.answerOrder[selectedVote],
                answer: answers.get(app.answerOrder[selectedVote])
            };
        
            console.log(`Submitting Vote: ${answerJSON.answer} -By: ${answerJSON.username} For prompt: ${voteQueueObj.prompt} -By: ${voteQueueObj.promptOwner}`);
            socket.emit("answerVote", {
                prompt: voteQueueObj.prompt,
                promptOwner: voteQueueObj.promptOwner,
                answer: answerJSON
            });
        },
        
        // Method to display the next prompt answer for voting
        displayNextVote() {
            if (app.queueFromAnsToVotes.length > 0) {
                const voteObj = app.queueFromAnsToVotes[0];
                const answers = new Map(Object.entries(voteObj.answersObj));
                app.answerOrder = Array.from(answers.keys());
        
                document.getElementById('promptToVote').textContent = `prompt: ${voteObj.prompt}`;
                document.getElementById('promptToVoteOwner').textContent = `By - ${voteObj.promptOwner}`;
                document.getElementById('leftPromptAnswer').textContent = answers.get(app.answerOrder[0]);
                document.getElementById('rightPromptAnswer').textContent = answers.get(app.answerOrder[1]);
            } else {
                console.log("No More answers Left To vote on");
                app.waitAdvancingPhase = true;
            }
        },
        
        // Method to clear the admin error prompt message
        clearAdminErrorPrompt() {
            if (this.gotAnAdmin) {
                document.getElementById("adminErrorPrompt").textContent = "";
            }
        },
        
        // Method to update the game phase and clear input fields accordingly
        updateGamePhase(data) {
            if (data.appState.roundState !== this.appState.roundState) {
                this.waitAdvancingPhase = false;
                this.clearInputFields('promptSubmit');
                this.clearInputFields('promptSubmitError');
                this.clearInputFields('answerSubmit');
                this.clearInputFields('answerSubmitError');
            }
        },
        
        // Method to update player roles based on received data
        updatePlayerRoles(data) {
            this.amAudience = data.me.playerGameState === 2;
        },
        
        // Method to update game entities based on received data
        updateGameEntities(data) {
            this.appState = data.appState;
            this.me = data.me;
            this.players = data.players;
            this.audience = data.audience;
        },
        
        // Method to enable prompt submission based on game state and round state
        enablePromptSubmission(data) {
            this.promptSubmissionAccepted = data.appState.gameState === 1 && data.appState.roundState === 1;
        },
        
        // Method to clear the text content of an HTML element based on its ID
        clearInputFields(elementId) {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = "";
            } else {
                console.error(`Element with ID ${elementId} not found.`);
            }
        }
    }        
});

function connect() {
    // Initialize web socket connection
    socket = io();

    // Event listener for successful connection
    socket.on('connect', () => app.connected = true);

    // Event listener for connection errors
    socket.on('connect_error', (error) => alert(`Unable to connect: ${error}`));

    // Event listener for disconnection
    socket.on('disconnect', () => {
        alert('Disconnected');
        app.connected = false;
    });

    // Event listeners for various messages
    socket.on('chat', (chatMsg) => app.handleChat(chatMsg));
    socket.on('loginResp', (loginMsg) => app.handleLoginResponse(loginMsg));
    socket.on('promptResp', (promptMsg) => app.handlePromptResponse(promptMsg));
    socket.on('promptToAnswer', (promptData) => app.handleAnswerFromPrompt(promptData.prompt, promptData.promptOwner));

    //Handle votingResults message
    socket.on('totalScores', function() {
        app.handleTotalScores();
    });

    // Event listener for 'answerToVoteOn' messages
    socket.on('answerToVoteOn', (voteData) => {
        app.waitFromVotesToAnswers = false;
        app.handleVottedAnswer(voteData.prompt, voteData.promptOwner, voteData.answers);
    });

    // Event listener for 'votingResults' messages
    socket.on('votingResults', (resultsData) => {
        app.handleVoteResults(resultsData);
    });

    // Event listener for 'gameState' messages
    socket.on('gameState', (gameStateMessage) => {
        console.log(`Updating game state to: ${JSON.stringify(gameStateMessage)}`);
        app.appState = gameStateMessage;
    });// Event listener for 'state' messages, updating the client's state based on received data
    socket.on('state', (data) => {
        console.log(`Updating State: ${JSON.stringify(data)}`);
        app.clearAdminErrorPrompt();
        app.updateGamePhase(data);
        app.updatePlayerRoles(data);
        app.updateGameEntities(data);
        app.enablePromptSubmission(data);
    });
    
    // Event listener for 'notEnoughPlayerForStart' messages
    socket.on('notEnoughPlayerForStart', () => {
        console.log("notEnoughPlayerForStart");
        // Display an error prompt for the admin if there are not enough players to start
        if (app.gotAnAdmin) {
            document.getElementById("adminErrorPrompt").textContent = "Not Enough Players To Start";
        }
    });
    
    // Event listener for 'gotAnAdmin' messages, updating the client's admin status
    socket.on('gotAnAdmin', (adminMessage) => {
        app.gotAnAdmin = adminMessage;
    });
}    