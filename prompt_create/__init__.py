import logging
import os
import json
import requests
from azure.functions import HttpRequest, HttpResponse
from azure.cosmos import CosmosClient
from azure.core.credentials import AzureKeyCredential
import uuid

# Import the DetectorFactory for langdetect
from langdetect import detect, DetectorFactory

# Set the langdetect DetectorFactory seed to ensure consistent results
DetectorFactory.seed = 0

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

    req_body = req.get_json()
    logging.info('Received a request to create a prompt for a player: {}'.format(req_body))

    text = req_body.get('text')
    username = req_body.get('username')
    
    try:
        result = False
        query = f"SELECT * FROM c WHERE c.username = '{username}'"
        items = list(player_container.query_items(query, enable_cross_partition_query=True))
    
        if len(items) == 1:
            if (len(text) < 15 or len(text) > 80):
                return HttpResponse(json.dumps({"result": False, "msg": "Prompt must be between 15 and 80 characters"}), status_code=400)
            else:
                # Detect the language directly in the main function
                language_detected = detect(text)

                # Set the list of supported languages for quiplash
                target_languages = ['en', 'es', 'it', 'sv', 'ru', 'id', 'bg', 'zh-Hans']
                
                # Check if detected language is one of the supported languages
                if language_detected in target_languages:
                    # Call the function to translate the text into multiple languages
                    translated_texts = translate_text(text, target_languages)
                    prompt_texts = []

                    # Loop through all languages and append them to a list
                    for language, translated_text in translated_texts.items():
                        prompt_texts.append({"language": language, "text": translated_text})

                    # Create a unique ID for the prompt document
                    prompt_id = str(uuid.uuid4())

                    # Create the prompt document with translations
                    prompt_document = {"id": prompt_id, "username": username, "texts": prompt_texts }

                    # Create the prompt item in the database
                    prompt_container.create_item(prompt_document)
                    return HttpResponse(json.dumps({"result": True, "msg": "OK"}))
                else:
                    return HttpResponse(json.dumps({"result": False, "msg": "Unsupported language"}))
        else:
            return HttpResponse(json.dumps({"result": False, "msg": "Player does not exist"}))
            
    except Exception as err:
        logging.error(err)
        return HttpResponse("An error occurred", status_code=500)

# Function to translate the text into multiple languages
def translate_text(text, target_languages):
    final_translation = {}

    for language in target_languages:
        headers = {
            'Ocp-Apim-Subscription-Key': TEXT_TRANSLATION_KEY,
            'Ocp-Apim-Subscription-Region': 'uksouth',
            'Content-type': 'application/json',
        }

        body = [{'text': text}]

        params = f"api-version=3.0&to={language}"
        translate_url = f"{TEXT_TRANSLATION_ENDPOINT}/translate?{params}"

        response = requests.post(translate_url, headers=headers, json=body)

        if response.status_code == 200:
            translated_text = response.json()[0]['translations'][0]['text']
            final_translation[language] = translated_text
        else:
            final_translation[language] = f"Translation failed for {language}"

    return final_translation
