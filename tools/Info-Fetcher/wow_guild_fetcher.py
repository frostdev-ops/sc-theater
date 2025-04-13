import requests
import json
import time
import re
from datetime import datetime
import os
import logging
import sys
import google.generativeai as genai
from typing import Dict, Any, Optional, Union

# Import helper functions
from wow_guild_helpers import (
    setup_logging, 
    extract_notes_recursively,
    detect_main_alt_status,
    parse_gemini_response,
    get_class_name_from_id,
    get_character_class_summary
)

# Initialize logger with default settings
logger = setup_logging(log_level=logging.INFO)

class WoWGuildFetcher:
    def __init__(self, client_id, client_secret, guild_name, realm, region="us", gemini_api_key=None):
        self.client_id = client_id
        self.client_secret = client_secret
        self.guild_name = guild_name
        self.realm = realm
        self.region = region
        self.access_token = None
        self.token_expiry = 0
        self.base_url = f"https://{region}.api.blizzard.com"
        self.namespace = f"profile-{region}"
        
        # Track failed endpoints to avoid repeatedly trying them
        self.failed_endpoints = set()
        self.failed_realm_endpoints = {}  # Map realms to sets of failed endpoints
        
        logger.info(f"Initializing WoWGuildFetcher for guild '{guild_name}' on realm '{realm}' ({region})")
        
        # Initialize Gemini if API key is provided
        self.gemini_model = None
        if gemini_api_key:
            logger.info("Gemini API key provided, initializing Gemini model")
            try:
                genai.configure(api_key=gemini_api_key)
                from config import get_gemini_generation_config
                gen_config = get_gemini_generation_config()
                logger.debug(f"Using Gemini model: {gen_config['model']} with temperature: {gen_config['temperature']}")
                
                self.gemini_model = genai.GenerativeModel(
                    model_name=gen_config['model'],
                    generation_config=genai.types.GenerationConfig(
                        temperature=gen_config['temperature'],
                        top_p=gen_config['top_p'],
                        top_k=gen_config['top_k'],
                        max_output_tokens=gen_config['max_output_tokens']
                    )
                )
                logger.info("Gemini model initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini model: {str(e)}")
                logger.debug("", exc_info=True)  # Log full traceback at debug level
    
    def _get_class_name_from_id(self, class_id):
        """Wrapper around the helper function for compatibility"""
        return get_class_name_from_id(class_id)
        
    def get_access_token(self, offline_mode=False):
        """Get OAuth access token from Blizzard API
        
        Args:
            offline_mode (bool): If True, will try to use cached token file even if expired
                                 and won't attempt to fetch a new one
        """
        now = time.time()
        token_cache_file = os.path.join('guild_data', 'token_cache.json')
        
        # Check for cached token in memory
        if self.access_token and now < self.token_expiry:
            logger.debug("Using cached access token from memory (still valid)")
            return self.access_token
        
        # Check for cached token in file
        if os.path.exists(token_cache_file):
            try:
                with open(token_cache_file, 'r') as f:
                    cached = json.load(f)
                    # If offline mode, use token regardless of expiry
                    if offline_mode:
                        logger.warning("OFFLINE MODE: Using cached token from file regardless of expiry")
                        self.access_token = cached["access_token"]
                        self.token_expiry = cached["expiry"]
                        return self.access_token
                    # Otherwise check if it's still valid
                    elif now < cached["expiry"]:
                        logger.debug("Using cached access token from file (still valid)")
                        self.access_token = cached["access_token"]
                        self.token_expiry = cached["expiry"]
                        return self.access_token
            except Exception as e:
                logger.warning(f"Error reading token cache: {str(e)}")
        
        # If in offline mode and no valid cache exists, we can't proceed
        if offline_mode:
            logger.error("OFFLINE MODE: No valid token cache found and cannot fetch new token")
            raise ValueError("Cannot operate in offline mode without a cached token")
            
        # Otherwise, request a new token
        logger.info("Requesting new OAuth access token from Blizzard API")
        token_url = f"https://{self.region}.battle.net/oauth/token"
        data = {"grant_type": "client_credentials"}
        auth = (self.client_id, self.client_secret)
        
        try:
            # Add timeout to avoid hanging indefinitely
            response = requests.post(token_url, data=data, auth=auth, timeout=10)
            response.raise_for_status()  # Raise exception for HTTP errors
            
            token_data = response.json()
            self.access_token = token_data["access_token"]
            self.token_expiry = now + token_data["expires_in"] - 300  # Subtract 5 minutes for safety
            
            # Cache the token to file
            os.makedirs('guild_data', exist_ok=True)
            with open(token_cache_file, 'w') as f:
                json.dump({
                    "access_token": self.access_token,
                    "expiry": self.token_expiry
                }, f)
            
            expires_in_minutes = token_data["expires_in"] // 60
            logger.info(f"Successfully obtained access token (expires in {expires_in_minutes} minutes)")
            return self.access_token
            
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Network connection error: {str(e)}")
            logger.error("Cannot connect to Blizzard API. Check your internet connection.")
            print("\n❌ NETWORK ERROR: Cannot connect to Blizzard API.")
            print("Please check your internet connection and try again.")
            print("If you want to use cached data (if available), add --offline flag.")
            logger.debug("Connection error details:", exc_info=True)
            raise ConnectionError("Cannot connect to Blizzard API. Check your internet connection.") from e
            
        except requests.exceptions.Timeout as e:
            logger.error(f"Request timeout: {str(e)}")
            logger.error("Blizzard API request timed out. Server might be overloaded or network is slow.")
            print("\n❌ TIMEOUT ERROR: Blizzard API request timed out.")
            print("Server might be overloaded or your network connection is slow.")
            logger.debug("Timeout error details:", exc_info=True)
            raise TimeoutError("Blizzard API request timed out.") from e
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error obtaining access token: {str(e)}")
            logger.debug("Token request error details:", exc_info=True)
            raise  # Re-raise the exception after logging
    
    def make_api_request(self, endpoint, params=None):
        """Make an authenticated request to the WoW API"""
        if params is None:
            params = {}
        
        params["namespace"] = self.namespace
        params["locale"] = "en_US"
        
        url = f"{self.base_url}{endpoint}"
        logger.debug(f"Making API request to: {url}")
        logger.debug(f"Request params: {params}")
        
        headers = {"Authorization": f"Bearer {self.get_access_token()}"}
        
        try:
            response = requests.get(url, headers=headers, params=params)
            
            # Handle rate limiting
            if response.status_code == 429:  # Too Many Requests
                retry_after = int(response.headers.get("Retry-After", 1))
                logger.warning(f"Rate limited by Blizzard API. Waiting {retry_after} seconds before retry...")
                time.sleep(retry_after)
                return self.make_api_request(endpoint, params)
            
            # Log response status
            logger.debug(f"API response status: {response.status_code}")
            
            # Raise for HTTP errors
            response.raise_for_status()
            
            # Parse JSON response
            response_data = response.json()
            logger.debug(f"Successfully received API response for {endpoint}")
            return response_data
            
        except requests.exceptions.RequestException as e:
            logger.error(f"API request error for {endpoint}: {str(e)}")
            logger.debug("API error details:", exc_info=True)
            raise  # Re-raise after logging
    
    def get_guild_profile(self):
        """Get basic guild profile information"""
        try:
            endpoint = f"/data/wow/guild/{self.realm.lower().replace(' ', '-')}/{self.guild_name.lower().replace(' ', '-')}"
            return self.make_api_request(endpoint)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                print(f"Guild '{self.guild_name}' not found on realm '{self.realm}'. Please check the guild name and realm.")
                return None
            else:
                raise
    
    def get_character_profile(self, character_name, realm=None):
        """Get a character's profile data
        
        Args:
            character_name (str): The character's name
            realm (str, optional): The realm name. Defaults to the guild's realm.
            
        Returns:
            dict: Character profile data
        """
        if realm is None:
            realm = self.realm
            
        logger.info(f"Fetching profile for character '{character_name}' on realm '{realm}'")
        
        try:
            endpoint = f"/profile/wow/character/{realm.lower().replace(' ', '-')}/{character_name.lower()}"
            return self.make_api_request(endpoint)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.warning(f"Character '{character_name}' not found on realm '{realm}'")
                return {}
            else:
                logger.error(f"Error fetching profile for '{character_name}': {str(e)}")
                return {}
    
    def get_guild_roster(self):
        """Get the guild's roster of characters"""
        endpoint = f"/data/wow/guild/{self.realm.lower().replace(' ', '-')}/{self.guild_name.lower().replace(' ', '-')}/roster"
        return self.make_api_request(endpoint)
    
    def get_guild_achievements(self):
        """Get the guild's achievements"""
        endpoint = f"/data/wow/guild/{self.realm.lower().replace(' ', '-')}/{self.guild_name.lower().replace(' ', '-')}/achievements"
        return self.make_api_request(endpoint)
        
    def get_active_members(self):
        """Get a list of actively playing members in the guild
        
        Returns:
            list: Active members with login information
        """
        roster = self.get_guild_roster()
        active_members = []
        
        if not roster or 'members' not in roster:
            return active_members
            
        logger.info(f"Processing {len(roster.get('members', []))} members for activity status")
        print(f"Checking activity status for {len(roster.get('members', []))} members...")
        
        # Get current time for calculating days since login
        now = datetime.now()
        
        for i, member in enumerate(roster['members']):
            if 'character' not in member:
                continue
                
            character = member['character']
            char_name = character.get('name', 'Unknown')
            
            # Skip characters without names
            if char_name == 'Unknown':
                continue
                
            # Get character realm
            char_realm = self.realm
            if 'realm' in character and isinstance(character['realm'], dict) and 'name' in character['realm']:
                char_realm = character['realm']['name']
                
            # Get last login information through profile
            try:
                profile = self.get_character_profile(char_name, char_realm)
                
                if 'last_login_timestamp' in profile:
                    last_login_time = datetime.fromtimestamp(profile['last_login_timestamp']/1000)
                    days_since_login = (now - last_login_time).days
                    last_login = last_login_time.strftime('%Y-%m-%d')
                    
                    # Skip characters who haven't logged in recently (more than 60 days)
                    if days_since_login > 60:
                        continue
                        
                    # Extract class information
                    class_name = "Unknown"
                    if 'character_class' in profile and 'name' in profile['character_class']:
                        class_name = profile['character_class']['name']
                    elif 'playable_class' in character:
                        if isinstance(character['playable_class'], dict):
                            if 'name' in character['playable_class']:
                                class_name = character['playable_class']['name']
                            elif 'id' in character['playable_class']:
                                class_id = character['playable_class']['id']
                                class_name = self._get_class_name_from_id(class_id)
                        elif isinstance(character['playable_class'], str):
                            class_name = character['playable_class']
                            
                    # Create active member entry
                    active_member = {
                        'name': char_name,
                        'level': character.get('level', profile.get('level', 0)),
                        'class': class_name,
                        'realm': char_realm,
                        'rank': member.get('rank', 99),
                        'last_login': last_login,
                        'days_since_login': days_since_login
                    }
                    
                    active_members.append(active_member)
                    
                    # Log progress occasionally
                    if (i+1) % 10 == 0:
                        print(f"Processed {i+1}/{len(roster['members'])} characters...")
            except Exception as e:
                logger.error(f"Error processing activity for character '{char_name}': {str(e)}")
                continue
                
        # Sort by most recent login
        active_members.sort(key=lambda x: x.get('days_since_login', 999))
        
        logger.info(f"Found {len(active_members)} active members (logged in within 60 days)")
        print(f"Found {len(active_members)} active members (logged in within 60 days)")
        
        return active_members
    
    def process_character_data(self, member):
        """Process a single guild member into a structured format for analysis
        
        Args:
            member (dict): Raw member data from the API
            
        Returns:
            dict: Processed character data or None if invalid
        """
        if 'character' not in member:
            return None
            
        character = member['character']
        char_name = character.get('name', 'Unknown')
        
        # Extract notes using recursive search
        notes = extract_notes_recursively(member)
        notes_combined = ' '.join([n for n in notes.values() if n])
        
        # Get playtime if available
        playtime = "Unknown"
        try:
            # Try to get character profile for playtime info
            char_realm = self.realm
            if 'realm' in character and isinstance(character['realm'], dict) and 'name' in character['realm']:
                char_realm = character['realm']['name']
                
            profile = member.get('profile', {})
            if not profile:
                try:
                    profile = self.get_character_profile(char_name, char_realm)
                except:
                    profile = {}
            
            if 'played_time' in profile:
                playtime = f"{profile['played_time']} hours"
            elif 'last_login_timestamp' in profile:
                last_login = datetime.fromtimestamp(profile['last_login_timestamp']/1000).strftime('%Y-%m-%d')
                playtime = f"Last login: {last_login}"
        except:
            playtime = "Unknown"
        
        # Format class name
        class_name = "Unknown"
        if 'playable_class' in character:
            if isinstance(character['playable_class'], dict):
                if 'name' in character['playable_class']:
                    class_name = character['playable_class']['name']
                elif 'id' in character['playable_class']:
                    class_id = character['playable_class']['id']
                    class_name = self._get_class_name_from_id(class_id)
            elif isinstance(character['playable_class'], str):
                class_name = character['playable_class']
        
        # Return formatted character data
        return {
            "name": char_name,
            "level": character.get('level', 0),
            "class": class_name,
            "rank": member.get('rank', 99),
            "notes": notes_combined,
            "playtime": playtime
        }
        
    def extract_notes_for_roster(self, roster):
        """Pre-process roster to extract notes for all members
        
        Args:
            roster (dict): Raw roster data from the API
            
        Returns:
            None (modifies roster in-place)
        """
        if not roster or 'members' not in roster:
            return
            
        logger.info(f"Extracting notes for {len(roster.get('members', []))} members")
        
        # Process each member to extract notes
        for i, member in enumerate(roster['members']):
            if 'character' in member:
                # Extract notes using recursive search
                notes = extract_notes_recursively(member)
                
                # Store the notes in member object
                member['note'] = notes.get('note', '')
                member['officer_note'] = notes.get('officer_note', '')
                
                # Debug first few notes
                if i < 3:  # Just print first few to avoid spam
                    print(f"Member {i} - {member['character'].get('name', 'Unknown')} - Note: '{member['note']}', Officer Note: '{member['officer_note']}'")
    
    def apply_classifications_to_roster(self, roster, classifications):
        """Apply Gemini classifications to the roster data
        
        Args:
            roster (dict): Roster data with members
            classifications (dict): Character classifications from Gemini
            
        Returns:
            None (modifies roster in-place)
        """
        if not roster or 'members' not in roster:
            return
            
        logger.info(f"Applying classifications to roster")
        
        # Track stats for summary
        applied_count = 0
        missing_count = 0
        
        # Process each member to apply classifications
        for member in roster['members']:
            if 'character' in member:
                char_name = member['character'].get('name', '')
                
                # Try to find classification for this character
                if char_name in classifications:
                    # Apply the classification
                    classification = classifications[char_name]
                    member['is_main'] = classification['is_main'] 
                    member['is_alt'] = classification['is_alt']
                    member['main_name'] = classification['main_name']
                    member['confidence'] = classification['confidence']
                    member['reasoning'] = classification['reasoning']
                    applied_count += 1
                else:
                    # Fall back to regex detection if not found
                    notes = {"note": member.get('note', ''), "officer_note": member.get('officer_note', '')}
                    status = detect_main_alt_status(notes, member['character'], member, roster)
                    member['is_main'] = status['is_main']
                    member['is_alt'] = status['is_alt']
                    member['main_name'] = status['main_name']
                    missing_count += 1
        
        # Log summary
        logger.info(f"Applied {applied_count} classifications from Gemini, used fallback for {missing_count} characters")
        print(f"Applied {applied_count} classifications from Gemini, used fallback for {missing_count} characters")
        
        # Count mains and alts for verification
        mains_count = sum(1 for m in roster['members'] if m.get('is_main', False))
        alts_count = sum(1 for m in roster['members'] if m.get('is_alt', False))
        print(f"Final roster: Found {mains_count} mains and {alts_count} alts")
    
    def process_roster_data_without_gemini(self, roster):
        """Process the roster data without using Gemini API
        
        Args:
            roster (dict): Raw roster data from the API
            
        Returns:
            dict: Processed roster with parsed notes
        """
        if not roster or 'members' not in roster:
            return roster
        
        # Process each member to extract main/alt status using regex approach
        for member in roster['members']:
            if 'character' in member:
                character = member['character']
                
                # Extract notes using recursive search
                notes = extract_notes_recursively(member)
                
                # Store the notes in member object
                member['note'] = notes.get('note', '')
                member['officer_note'] = notes.get('officer_note', '')
                
                # Detect if this is a main or alt character
                status = detect_main_alt_status(notes, character, member, roster)
                member['is_main'] = status['is_main']
                member['is_alt'] = status['is_alt']
                member['main_name'] = status['main_name']
                
        # Log summary of detection results
        mains_count = sum(1 for m in roster['members'] if m.get('is_main', False))
        alts_count = sum(1 for m in roster['members'] if m.get('is_alt', False))
        logger.info(f"Detected {mains_count} mains and {alts_count} alts using pattern detection")
        print(f"Detected {mains_count} mains and {alts_count} alts using pattern detection")
        
        return roster
    
    def gemini_classify_by_rank(self, roster: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Use Gemini to analyze characters by rank and determine main/alt status
        
        Args:
            roster (dict): The complete roster data with all characters
            
        Returns:
            dict: Dictionary mapping character names to their classification results
        """
        if not self.gemini_model:
            logger.warning("Gemini model not initialized, skipping roster classification")
            return {}
            
        logger.info(f"Using Gemini API to classify roster of {len(roster.get('members', []))} characters by rank")
        
        # Overall results
        all_classifications = {}
        
        try:
            # Process roster members and group them by rank
            rank_groups = {}
            
            # First pass - group characters by rank
            for member in roster.get('members', []):
                if 'character' not in member:
                    continue
                
                rank = member.get('rank', 99)
                if rank not in rank_groups:
                    rank_groups[rank] = []
                
                character_data = self.process_character_data(member)
                if character_data:
                    rank_groups[rank].append(character_data)
            
            # Create an example JSON response template
            example_json = '''
{
  "CharacterOne": {"status":"MAIN", "confidence":0.95, "main_name":null, "reasoning":"High rank officer with distinctive name"},
  "CharacterTwo": {"status":"ALT", "confidence":0.87, "main_name":"CharacterOne", "reasoning":"Similar name to CharacterOne, has alt in notes"}
}
'''
            
            # Process each rank group separately
            for rank, characters in sorted(rank_groups.items()):
                logger.info(f"Processing {len(characters)} characters with rank {rank}")
                print(f"\n==== PROCESSING {len(characters)} CHARACTERS WITH RANK {rank} ====")
                
                # Skip empty groups
                if not characters:
                    continue
                
                # Format the prompt for the current rank group
                prompt = f"""
You are analyzing World of Warcraft characters from rank {rank} in a guild.
Your task is to determine which characters are MAIN characters and which are ALT characters.

# Context Information
- This set contains {len(characters)} characters all at rank {rank}
- Players typically have ONE main character and possibly MULTIPLE alt characters
- Each rank has its own main characters and their alts are generally in the same rank
- The data includes character names, levels, classes, ranks, notes, and activity info

# Classification Heuristics (in order of importance)
1. Explicit note indicators: Notes containing "alt", "main", "twink", etc. are the strongest signal
2. Character Class: Players are unlikely to have more than one of the same class as an alt or main. This is a strong signal
3. Level: Max level (80) characters are more likely to be mains, but not exclusively. People can have multiple Max Level characters. This is a weak signal
4. Playtime/Activity: Characters with more playtime are likely mains (This metric may not be available)
5. Name similarity: Similar names often indicate alts (e.g., "Playername" and "Playeralt") but not always this is a weak signal

# Name Patterns to Consider
- Same name prefix with different suffixes (e.g., "Shadow" and "Shadowpriest")
- Same name with class/role indicators (e.g., "Tanky" and "Healytanky")
- Very similar names with slight variations (e.g., "Wizard" and "Wizardly")

# Character Data for Rank {rank}
{json.dumps(characters, indent=2)}

# Response Format
Your response MUST be valid JSON with exactly this structure:

{example_json}

# Response Rules
1. For MAIN characters: 
   - "status" is exactly "MAIN"
   - "confidence" is a number from 0-1
   - "main_name" is null
   - "reasoning" is a brief explanation

2. For ALT characters: 
   - "status" is exactly "ALT"
   - "confidence" is a number from 0-1
   - "main_name" is the name of their main character
   - "reasoning" is a brief explanation

3. Include ALL characters from this rank in your response

4. Do not include ANY text outside the JSON structure
"""
                
                logger.debug(f"Sending rank {rank} analysis prompt to Gemini")
                print(f"Sending {len(characters)} rank {rank} characters to Gemini for analysis...")
                
                # Call Gemini API with current rank group
                try:
                    response = self.gemini_model.generate_content(prompt)
                    
                    # Detailed logging for Gemini response
                    logger.debug(f"Received Gemini response for rank {rank} analysis")
                    
                    if hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                        logger.info(f"Prompt feedback for rank {rank} analysis: {response.prompt_feedback}")
                    
                    # Log the full response text from Gemini
                    if hasattr(response, 'text'):
                        logger.info(f"Full Gemini response for rank {rank} analysis:\n{response.text}")
                        # Print shorter summary of the response
                        print(f"Received Gemini response for rank {rank} characters ({len(response.text)} characters)")
                        response_text = response.text
                    else:
                        # Handle case where response might be structured differently
                        logger.warning("Gemini response doesn't have 'text' attribute, trying to convert to string")
                        response_text = str(response)
                        print(f"Received unusual Gemini response format, converted to string ({len(response_text)} characters)")
                    
                    # Process the response to extract classifications
                    rank_classifications = parse_gemini_response(response_text)
                    
                    # Add to overall results
                    all_classifications.update(rank_classifications)
                    
                    # Log result counts
                    mains_count = sum(1 for _, v in rank_classifications.items() if v.get('is_main', False))
                    alts_count = sum(1 for _, v in rank_classifications.items() if v.get('is_alt', False))
                    logger.info(f"Rank {rank} classifications: {mains_count} mains, {alts_count} alts")
                    print(f"Rank {rank} classifications: Found {mains_count} mains, {alts_count} alts")
                except Exception as e:
                    logger.error(f"Error processing rank {rank} with Gemini: {str(e)}")
                    print(f"⚠️ Error analyzing rank {rank}: {str(e)}")
                    logger.debug("Gemini processing error details:", exc_info=True)
            
            # Overall stats
            total_mains = sum(1 for _, v in all_classifications.items() if v.get('is_main', False))
            total_alts = sum(1 for _, v in all_classifications.items() if v.get('is_alt', False))
            logger.info(f"Total classifications: {total_mains} mains, {total_alts} alts")
            print(f"Total classifications: Found {total_mains} mains, {total_alts} alts")
            
            return all_classifications
            
        except Exception as e:
            logger.error(f"Gemini API error for rank-based roster analysis: {str(e)}")
            logger.debug("Gemini API error details:", exc_info=True)
            return {}
    
    def get_class_distribution(self, roster):
        """Generate a class distribution summary from the roster data
        
        Args:
            roster (dict): The guild roster data
            
        Returns:
            dict: Mapping of class names to counts
        """
        return get_character_class_summary(roster)
