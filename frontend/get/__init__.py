import json
import logging

import os
from azure.functions import HttpRequest, HttpResponse
from azure.cosmos import CosmosClient

# Read environment variables
COSMOS_ENDPOINT = os.environ['COSMOS_ENDPOINT']
COSMOS_KEY = os.environ['COSMOS_KEY']
DATABASE_NAME = os.environ['DATABASE_NAME']
PROMPT_CONTAINER_NAME = os.environ['PROMPT_CONTAINER_NAME']
PLAYER_CONTAINER_NAME = os.environ['PLAYER_CONTAINER_NAME']
TEXT_TRANSLATION_KEY = os.environ['TranslationKey']
TEXT_TRANSLATION_ENDPOINT = os.environ['TranslationEndpoint']

# Initialize Cosmos clients
cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
database = cosmos_client.get_database_client(DATABASE_NAME)
prompt_container = database.get_container_client(PROMPT_CONTAINER_NAME)
player_container = database.get_container_client(PLAYER_CONTAINER_NAME)

def main(req: HttpRequest) -> HttpResponse:
    data = req.get_json()

    try:
        players = data.get("players")
        lang_code = data.get("language")
        result = []

        for player in players:
            query = f"SELECT * FROM c WHERE c.username = '{player}'"
            items = list(prompt_container.query_items(query, enable_cross_partition_query=True))

            for item in items:
                for text_entry in item["texts"]:
                    if text_entry["language"] == lang_code:
                        result.append({"id": item["id"], "text": text_entry["text"], "username": player  })
        
        return HttpResponse(json.dumps(result), mimetype="application/json", status_code=200)

    except KeyError:
        return HttpResponse("Invalid input data.", status_code=400)

       