import json
import os
import uuid

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
            return HttpResponse(json.dumps({"result": False, "msg": "Invalid input. 'username' and 'password' are required."}), status_code=400)

        username = req_body["username"]
        password = req_body["password"]

        if len(username) < 4 or len(username) > 14:
            return HttpResponse(json.dumps({"result": False, "msg": "Username less than 4 characters or more than 14 characters"}), status_code=400)

        if len(password) < 10 or len(password) > 20:
            return HttpResponse(json.dumps({"result": False, "msg": "Password less than 10 characters or more than 20 characters"}), status_code=400)

        # Check if the player with the given username already exists
        query = "SELECT * FROM c WHERE c.username = @username"
        parameters = [{"name": "@username", "value": username}]
        existing_user = list(player_container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True
        ))

        if existing_user:
            return HttpResponse(json.dumps({"result": False, "msg": "Username already exists"}), status_code=400)

        # Create a new player document
        player_document = {
            "id": str(uuid.uuid4()),
            "username": username,
            "password": password,
            "games_played": 0,
            "total_score": 0
        }

        # Add the new player document to the player container
        player_container.create_item(player_document)
        return HttpResponse(json.dumps({"result": True, "msg": "OK"}), status_code=200)

    except Exception as e:
        return HttpResponse(json.dumps({"result": False, "msg": str(e)}), status_code=500)
