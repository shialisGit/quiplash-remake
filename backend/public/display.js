var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        // User and Connection State
        connected: false,
        username: "display",
        adminCred: "No Admin",

        // Game Progress State
        appState: {
            gameState: 0, // 0: waitingGameStart
            round: 1,
            roundState: 0 // 0: waitingGameStart, 1: promptCollection, ...
        },

        // Messaging
        messages: [],
        chatmessage: '',

        // Player and Audience State
        players: null, // Players = {username, ScoreThisSession, playerGameState}
        audience: null,
        amAudience: false,

        // Game Flow Control
        waitAdvancingPhase: false,
        waitFromAnswersToPrompts: true,
        waitFromVotesToAnswers: true,

        // Voting Mechanics
        queueOfPromptsToAnswer: [], // Current prompt is 1st in queue
        queueFromAnsToVotes: [], // Current prompt is 1st in queue
        answerOrder: [],
        voteResults: null
    },
    mounted: function() {
        connect();
    },
    methods: {// Function to handle incoming chat messages
        handleChat(message) {
            // Ensure that the chat message history doesn't exceed 10 messages
            if (this.messages.length >= 10) {
                this.messages.pop(); // Remove the oldest message
            }
            this.messages.unshift(message); // Add the new message to the beginning of the array
        },
        
        // Function to handle the update of the number of collected prompts
        handlePromptsNumUpdate(count, target) {
            document.getElementById("promptNumUpdate").textContent = `${count} prompts collected from ${target}`;
        },
        
        // Function to handle the update of the number of collected answers
        handleAnswerNumUpdate(count, target) {
            document.getElementById("answerNumUpdate").textContent = `${count} answers collected from ${target}`;
        },
        
        // Function to handle the update of the number of collected votes
        handleUpdatedVotesSum(count, target) {
            document.getElementById("votesNumUpdate").textContent = `${count} votes collected from ${target}`;
        },
        
        // Function to handle the display of vote results and log details
        handleVoteResults(votesFromPromptsTemp) {
            this.updateVoteResults(votesFromPromptsTemp);
            this.logVoteDetails();
        },
        
        // Function to log detailed vote results
        logVoteDetails() {
            // Log details of votes for each prompt and answer
            app.voteResults.forEach((obj, key) => {
                console.log(`${obj.promptOwner}: ${obj.prompt}: ${obj.answerOwner1}: ${obj.answer1}: ${obj.voters1}`);
                console.log(`${obj.promptOwner}: ${obj.prompt}: ${obj.answerOwner2}: ${obj.answer2}: ${obj.voters2}`);
            });
            console.log("Votes Displayed");
        },
        
        // Function to handle the display of end-of-game message for total scores
        handleTotalScores() {
            if (app.appState.round === 3 && app.appState.roundState === 5) {
                document.getElementById("lastRoundPrompt").textContent = "Scores will be updated at the end of the game)";
        
                // Log confirmation message
                console.log("Display end of game message");
            }
        },
        
        // Function to update vote results based on received data
        updateVoteResults(votesFromPromptsTemp) {
            console.log("Votes to display received:");
            const votesFromPromptsMap = new Map(Object.entries(votesFromPromptsTemp));
            app.voteResults = votesFromPromptsMap;
        },
        
        // Function to update AppState, Players, and Audience based on received data
        updateAPA(data) {
            app.appState = data.appState;
            app.players = data.players;
            app.audience = data.audience;
        }
    }
});
// Establish a connection to the server
function connect() {
    // Prepare web socket
    socket = io();

    // Connect to the server
    socket.on('connect', function() {
        console.log("In Connect Func");
        // Notify the server about the display connection
        socket.emit("display", "");
        // Set connected state to true
        app.connected = true;
    });

    // Event listener for connection errors
    socket.on('connect_error', (message) => {
        // Display an alert for connection errors
        alert(`Unable to connect: ${message}`);
    });

    // Event listener for disconnection
    socket.on('disconnect', () => {
        // Display an alert on disconnection
        alert('Disconnected');
        // Set connected state to false
        app.connected = false;
    });

    // Event listener for incoming chat messages
    socket.on('chat', (message) => {
        // Handle incoming chat messages
        app.handleChat(message);
    });

    // Event listener for 'state' messages
    socket.on('state', (stateData) => {
        console.log(`Updating State: ${JSON.stringify(stateData)}`);
        // Update application state based on received data
        updateAppState(stateData);
    });

    // Event listener for 'adminCred' messages
    socket.on('adminCred', adminData => {
        // Update the application with the current admin information
        app.adminCred = adminData;
    });

    // Register event handler for votes number update
    socket.on('votesNumUpdate', data => {
        // Handle the update of the number of collected votes
        app.handleUpdatedVotesSum(data.count, data.target);
    });

    // Register event handler for prompts number update
    socket.on('promptsNumUpdate', data => {
        // Handle the update of the number of collected prompts
        app.handlePromptsNumUpdate(data.count, data.target);
    });

    // Register event handler for answers number update
    socket.on('answerNumUpdate', data => {
        // Handle the update of the number of collected answers
        app.handleAnswerNumUpdate(data.count, data.target);
    });

    // Register event handler for total scores update
    socket.on('totalScores', () => {
        // Handle the display of total scores
        app.handleTotalScores();
    });

    // Register event handler for voting results
    socket.on('votingResults', data => {
        // Handle the display of voting results
        app.handleVoteResults(data);
    });
}
