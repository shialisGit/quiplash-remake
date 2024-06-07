import json
import logging
import os
from azure.functions import HttpRequest, HttpResponse
from azure.cosmos import CosmosClient

# Import the PROMPT_CONTAINER_NAME from your 'get' module
from get import PROMPT_CONTAINER_NAME

# Read environment variables
COSMOS_ENDPOINT = os.environ['COSMOS_ENDPOINT']
COSMOS_KEY = os.environ['COSMOS_KEY']
DATABASE_NAME = os.environ['DATABASE_NAME']
PLAYER_CONTAINER_NAME = os.environ['PLAYER_CONTAINER_NAME']

# Initialize Cosmos clients
cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
database = cosmos_client.get_database_client(DATABASE_NAME)
player_container = database.get_container_client(PLAYER_CONTAINER_NAME)

def main(req: HttpRequest) -> HttpResponse:
    req_body = req.get_json()
    top = req_body.get('top')

    # Check if the 'top' value is valid
    if top <= 0:
        return HttpResponse("Top value must be greater than 0.", status_code=400)

    try:
        # Read all items from the player container, filter, and sort in one go
        players = player_container.query_items(
            query="SELECT c.username, c.games_played, c.total_score FROM c",
            enable_cross_partition_query=True
        )
        
        # Sort the players based on criteria and limit to 'top' results
        result = sorted(
            players, 
            key=lambda x: (-x['total_score'], x['games_played'], x['username'])
        )[:top]

        return HttpResponse(json.dumps(result))
    except Exception:
        logging.error()
        return HttpResponse("Error Occurred", status_code=500)
