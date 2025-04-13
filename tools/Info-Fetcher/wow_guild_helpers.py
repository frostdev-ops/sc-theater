"""
Helper functions for WoW Guild Fetcher
Contains utility functions for processing character data, classifying characters, etc.
"""

import json
import re
import logging
import os
import sys
from datetime import datetime
from typing import Dict, Any, Optional, Union, List

# Configure logging with more verbose output
def setup_logging(log_level=logging.INFO, log_to_file=True):
    """Configure logging with console and optional file output"""
    # Create logs directory in guild_data if it doesn't exist
    log_dir = os.path.join('guild_data', 'logs')
    os.makedirs(log_dir, exist_ok=True)
    
    # Generate log filename with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = os.path.join(log_dir, f'wow_guild_fetcher_{timestamp}.log')
    
    # Set up logger
    logger = logging.getLogger('wow_guild_fetcher')
    logger.setLevel(log_level)
    logger.handlers = []  # Clear any existing handlers
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)
    
    # Add file handler if requested
    if log_to_file:
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(log_level)
        file_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)
        print(f"Logging to file: {log_file}")
    
    return logger

# Initialize logger with default settings
logger = setup_logging(log_level=logging.INFO)

def get_class_name_from_id(class_id):
    """Map a class ID to a class name."""
    class_mapping = {
        1: "Warrior", 
        2: "Paladin", 
        3: "Hunter", 
        4: "Rogue", 
        5: "Priest", 
        6: "Death Knight", 
        7: "Shaman", 
        8: "Mage",
        9: "Warlock", 
        10: "Monk", 
        11: "Druid", 
        12: "Demon Hunter", 
        13: "Evoker"
    }
    return class_mapping.get(class_id, "Unknown")

def extract_notes_recursively(data, depth=0, path=""):
    """Recursively search for notes in member data at any nesting level
    
    Args:
        data: The data structure to search
        depth: Current recursion depth (to prevent infinite recursion)
        path: Current path in the data structure for debugging
        
    Returns:
        dict: Dictionary with found note values
    """
    results = {"character_note": "", "officer_note": "", "note": "", "public_note": ""}
    
    if depth > 10:  # Prevent infinite recursion
        return results
    
    if isinstance(data, dict):
        # Direct check for note fields
        for note_key in ["note", "character_note", "officer_note", "public_note"]:
            if note_key in data and isinstance(data[note_key], str):
                results[note_key] = data[note_key]
        
        # Recursive search for nested notes
        for key, value in data.items():
            if isinstance(value, (dict, list)):
                nested_results = extract_notes_recursively(value, depth + 1, f"{path}.{key}")
                # Update any found values
                for note_key, note_value in nested_results.items():
                    if note_value and not results[note_key]:
                        results[note_key] = note_value
    
    elif isinstance(data, list):
        # Search through list items
        for i, item in enumerate(data):
            if isinstance(item, (dict, list)):
                nested_results = extract_notes_recursively(item, depth + 1, f"{path}[{i}]")
                # Update any found values
                for note_key, note_value in nested_results.items():
                    if note_value and not results[note_key]:
                        results[note_key] = note_value
    
    return results

def detect_main_alt_status(notes, character, member, roster):
    """Use regex patterns and heuristics to detect if a character is a main or an alt
    
    Args:
        notes (dict): Note fields from the character
        character (dict): Character data
        member (dict): Full member data
        roster (dict): Complete roster data
        
    Returns:
        dict: Main/alt status information
    """
    result = {
        'is_main': False,
        'is_alt': False,
        'main_name': None
    }
    
    # Combine notes for searching
    note_text = (notes.get('note', '') + ' ' + notes.get('officer_note', '')).lower()
    char_name = character.get('name', '')
    
    # Search for alt indicators in notes
    alt_patterns = [
        r'\balt\b',
        r'\btwink\b',
        r'\balternative\b',
        r'\balt\s+of\s+(\w+)',
        r'\balternative\s+of\s+(\w+)',
        r'\balt\s*:\s*(\w+)',
        r'\balternative\s*:\s*(\w+)',
        r'\balt\s*-\s*(\w+)',
        r'\b(\w+)[\'s]?\s+alt\b'
    ]
    
    # Search for main indicators in notes
    main_patterns = [
        r'\bmain\b',
        r'\bprimary\b',
        r'\bmain\s+character\b'
    ]
    
    # Check for alt indicators
    for pattern in alt_patterns:
        match = re.search(pattern, note_text)
        if match:
            result['is_alt'] = True
            # Try to extract main character name
            if match.lastindex and match.lastindex >= 1:
                main_name = match.group(1).strip()
                if main_name:
                    result['main_name'] = main_name.capitalize()
            break
            
    # Check for main indicators if not already determined to be an alt
    if not result['is_alt']:
        for pattern in main_patterns:
            if re.search(pattern, note_text):
                result['is_main'] = True
                break
    
    # If neither alt nor main was detected, make an educated guess
    if not result['is_alt'] and not result['is_main']:
        # Rank 0-2 are usually officers/leadership - likely mains
        if member.get('rank', 99) <= 2:
            result['is_main'] = True
        # Max level characters with no indication of being an alt are likely mains
        elif character.get('level', 0) >= 80:  # max level in current expansion
            result['is_main'] = True
    
    return result

def parse_gemini_response(response_text):
    """Parse Gemini response text into character classifications
    
    Args:
        response_text (str): The raw text response from Gemini
        
    Returns:
        dict: Dictionary mapping character names to classification data
    """
    try:
        # Special handling for code blocks - very common with Gemini responses
        response_text = response_text.strip()
        
        # First attempt: check and extract from markdown code blocks with language specifier
        if "```json" in response_text:
            logger.info("Found code block with JSON language specifier")
            # Find the start of the JSON content (after ```json line)
            start_marker = "```json"
            start_pos = response_text.find(start_marker) + len(start_marker)
            end_pos = response_text.rfind("```")
            
            if end_pos > start_pos:
                # Extract content between the markers
                response_text = response_text[start_pos:end_pos].strip()
                logger.info("Successfully extracted content from ```json code block")
        
        # Second attempt: check for generic code blocks (```)
        elif response_text.startswith("```") and response_text.endswith("```"):
            logger.info("Found generic code block")
            # Remove first line and last line
            lines = response_text.split('\n')
            response_text = '\n'.join(lines[1:-1])
            logger.info("Successfully extracted content from generic code block")
        
        # If there are triple backticks anywhere else, try to extract content between them
        elif "```" in response_text:
            start_marker = "```"
            start_pos = response_text.find(start_marker) + len(start_marker)
            
            # If there's a language specifier on the first line, skip it
            if '\n' in response_text[start_pos:]:
                first_linebreak = response_text.find('\n', start_pos)
                start_pos = first_linebreak + 1
                
            end_pos = response_text.rfind("```")
            
            if end_pos > start_pos:
                response_text = response_text[start_pos:end_pos].strip()
                logger.info("Successfully extracted content from code block")
        
        # Log what we're trying to parse
        logger.debug(f"Attempting to parse JSON: {response_text[:100]}...")
        
        # Try to parse the response as JSON
        try:
            results = json.loads(response_text)
            logger.debug(f"Successfully parsed Gemini JSON response")
            
            # Convert structure to match the old format
            classifications = {}
            
            for character_name, result in results.items():
                classifications[character_name] = {
                    'is_main': result.get('status') == 'MAIN',
                    'is_alt': result.get('status') == 'ALT',
                    'main_name': result.get('main_name'),
                    'confidence': result.get('confidence', 0.0),
                    'reasoning': result.get('reasoning', '')
                }
                
                # Log the classification
                logger.debug(f"Gemini classified {character_name} as: {'MAIN' if classifications[character_name]['is_main'] else 'ALT'} with confidence {classifications[character_name]['confidence']}")
            
            return classifications
            
        except json.JSONDecodeError:
            # If we still can't parse it as JSON directly, try regex methods
            logger.warning("Failed to parse response as JSON, trying regex extraction")
            
            # Try to match a JSON object pattern
            import re
            json_pattern = r'\{\s*"[^"]+"\s*:\s*\{.+?\}\s*(?:,|$)'
            
            # Find all matching JSON object fragments
            json_fragments = re.findall(json_pattern, response_text, re.DOTALL)
            
            if json_fragments:
                # Combine the fragments into a complete JSON object
                combined_json = '{' + ''.join(json_fragments).rstrip(',') + '}'
                logger.info(f"Built JSON from {len(json_fragments)} fragments")
                
                # Try to parse the combined JSON
                results = json.loads(combined_json)
                
                # Convert to our format
                classifications = {}
                for character_name, result in results.items():
                    classifications[character_name] = {
                        'is_main': result.get('status') == 'MAIN',
                        'is_alt': result.get('status') == 'ALT',
                        'main_name': result.get('main_name'),
                        'confidence': result.get('confidence', 0.0),
                        'reasoning': result.get('reasoning', '')
                    }
                
                logger.info(f"Successfully processed {len(classifications)} character classifications")
                return classifications
            else:
                logger.error("Could not extract JSON fragments from the response")
                raise ValueError("Failed to extract JSON from Gemini response")
                
    except Exception as e:
        logger.error(f"Failed to parse Gemini response: {str(e)}")
        logger.debug(f"Full response text: {response_text}")
        return {}

def get_character_class_summary(roster_data: Dict[str, Any]) -> Dict[str, int]:
    """Generate a summary of character classes from roster data.
    
    Args:
        roster_data: The guild roster data
        
    Returns:
        dict: Mapping of class names to counts
    """
    class_counts = {}
    
    # Process members to count classes
    for member in roster_data.get('members', []):
        if 'character' not in member:
            continue
            
        character = member['character']
        class_name = "Unknown"
        
        # Try to get class name
        if 'playable_class' in character:
            if isinstance(character['playable_class'], dict):
                if 'name' in character['playable_class']:
                    class_name = character['playable_class']['name']
                elif 'id' in character['playable_class']:
                    class_id = character['playable_class']['id']
                    class_name = get_class_name_from_id(class_id)
            elif isinstance(character['playable_class'], str):
                class_name = character['playable_class']
        
        # Update class counts
        if class_name in class_counts:
            class_counts[class_name] += 1
        else:
            class_counts[class_name] = 1
    
    return class_counts
