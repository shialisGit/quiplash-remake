import os
import json

from azure.functions import HttpRequest, HttpResponse
from azure.cosmos import CosmosClient, exceptions

# Read environment variables
COSMOS_ENDPOINT = os.environ['COSMOS_ENDPOINT']
COSMOS_KEY = os.environ['COSMOS_KEY']
DATABASE_NAME = os.environ['DATABASE_NAME']
PLAYER_CONTAINER_NAME = os.environ['PLAYER_CONTAINER_NAME']

# Initialize Cosmos client
client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
database = client.get_database_client(DATABASE_NAME)
player_container = database.get_container_client(PLAYER_CONTAINER_NAME)

def main(req: HttpRequest) -> HttpResponse:
    try:
        req_body = req.get_json()

        if "username" not in req_body:
            return HttpResponse(json.dumps({"result": False, "msg": "Username missing"}), status_code=400)

        username = req_body["username"]
        add_to_games_played = req_body.get("add_to_games_played", 0)
        add_to_score = req_body.get("add_to_score", 0)

        if not (isinstance(add_to_games_played, int) and isinstance(add_to_score, int)):
            return HttpResponse(json.dumps({"result": False, "msg": "Invalid input. 'add_to_games_played' and 'add_to_score' must be integers."}), status_code=400)

        # Query the player by username
        player_query = "SELECT * FROM c WHERE c.username = @username"
        parameters = [{"name": "@username", "value": username}]
        player_docs = list(player_container.query_items(
            query=player_query,
            parameters=parameters,
            enable_cross_partition_query=True
        ))

        if not player_docs:
            return HttpResponse(json.dumps({"result": False, "msg": "Player does not exist"}), status_code=400)

        player = player_docs[0]
        player['games_played'] += add_to_games_played
        player['total_score'] += add_to_score

        # Replace the player document with the updated values
        player_container.replace_item(item=player, body=player)

        return HttpResponse(json.dumps({"result": True, "msg": "OK"}), status_code=200)

    except exceptions.CosmosHttpResponseError as e:
        return HttpResponse(json.dumps({"result": False, "msg": "An error occurred during the update"}), status_code=500)

    except Exception as e:
        return HttpResponse(json.dumps({"result": False, "msg": str(e)}), status_code=500)
