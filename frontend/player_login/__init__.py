import json
import os
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

        if "username" not in req_body or "password" not in req_body:
            return HttpResponse(json.dumps({"result": False, "msg": "Username or password missing"}), status_code=400)

        username = req_body["username"]
        password = req_body["password"]

        # Check if the player with the given username exists
        query = "SELECT * FROM c WHERE c.username = @username"
        parameters = [{"name": "@username", "value": username}]
        existing_user = list(player_container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True
        ))

        if not existing_user:
            return HttpResponse(json.dumps({"result": False, "msg": "Username or password incorrect"}), status_code=400)

        # Check if the password matches (this is a simple example, in a real app, passwords should be hashed)
        if existing_user[0]["password"] != password:
            return HttpResponse(json.dumps({"result": False, "msg": "Username or password incorrect"}), status_code=400)

        return HttpResponse(json.dumps({"result": True, "msg": "OK"}), status_code=200)

    except Exception as e:
        return HttpResponse(json.dumps({"result": False, "msg": str(e)}), status_code=500)

# /player/update
def update_player(req: HttpRequest) -> HttpResponse:
    try:
        req_body = req.get_json()

        if "username" not in req_body or ("add_to_games_played" not in req_body and "add_to_score" not in req_body):
            return HttpResponse(json.dumps({"result": False, "msg": "Invalid input"}), status_code=400)

        username = req_body["username"]
        add_to_games_played = req_body.get("add_to_games_played", 0)
        add_to_score = req_body.get("add_to_score", 0)

        # Check if the player with the given username exists
        query = "SELECT * FROM c WHERE c.username = @username"
        parameters = [{"name": "@username", "value": username}]
        existing_user = list(player_container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True
        ))

        if not existing_user:
            return HttpResponse(json.dumps({"result": False, "msg": "Player does not exist"}), status_code=400)

        # Update player's games_played and total_score
        existing_user[0]["games_played"] += add_to_games_played
        existing_user[0]["total_score"] += add_to_score
        player_container.upsert_item(existing_user[0])

        return HttpResponse(json.dumps({"result": True, "msg": "OK"}), status_code=200)

    except Exception as e:
        return HttpResponse(json.dumps({"result": False, "msg": str(e)}), status_code=500)
