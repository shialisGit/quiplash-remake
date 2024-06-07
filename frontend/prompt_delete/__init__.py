import json
import logging
import os
import re
from azure.functions import HttpRequest, HttpResponse
from azure.cosmos import CosmosClient, exceptions

# Read environment variables
COSMOS_ENDPOINT = os.environ['COSMOS_ENDPOINT']
COSMOS_KEY = os.environ['COSMOS_KEY']
DATABASE_NAME = os.environ['DATABASE_NAME']
PLAYER_CONTAINER_NAME = os.environ['PLAYER_CONTAINER_NAME']
PROMPT_CONTAINER_NAME = os.environ["PROMPT_CONTAINER_NAME"]

# Initialize Cosmos client
client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
database = client.get_database_client(DATABASE_NAME)
player_container = database.get_container_client(PLAYER_CONTAINER_NAME)
prompt_container = database.get_container_client(PROMPT_CONTAINER_NAME)

def main(req: HttpRequest) -> HttpResponse:
    logging.info('Python HTTP trigger function processed a request.')

    # Get JSON data from the request
    data = req.get_json()
    try:
        deleted_count = 0
        result = False

        if "player" in data:
            # Delete prompts for a specific player
            username = data.get("player")

            # Query for prompts authored by the given player
            query = f"SELECT * FROM c WHERE c.username = '{username}'"
            items = list(prompt_container.query_items(query, enable_cross_partition_query=True))
            deleted_count = len(items)
            result = True

            # Delete all prompts authored by the player
            for item in items:
                prompt_container.delete_item(item, item.get('username'))
        elif "word" in data:
            # Delete prompts containing an offensive word
            offensive_word = data.get("word")

            # Iterate over all prompts to find and delete those containing the offensive word
            for item in prompt_container.read_all_items():
                texts = item.get('texts', [])
                pr_texts = [text['text'] for text in texts if 'text' in text]
                
                # Use regular expressions to match whole words with word boundaries
                if any(re.search(rf'\b{re.escape(offensive_word)}\b', text) for text in pr_texts):
                    prompt_container.delete_item(item, item.get('username'))
                    deleted_count += 1
                    result = True
                    # Break to avoid multiple deletions for the same document

        return HttpResponse(json.dumps({"result": result, "msg": f"{deleted_count} prompts deleted"}))
    except Exception:
        return HttpResponse("Invalid input data.", status_code=400)
