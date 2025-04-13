#!/usr/bin/env python3
"""
Debug utility for finding and parsing guild notes

This script analyzes the guild roster to find where notes are stored in the API response
and tests different parsing strategies for main/alt detection.

Usage:
  python debug_notes_parser.py [guild] [realm] [region]
"""

import json
import os
import sys
import re
from wow_guild_fetcher import WoWGuildFetcher

def analyze_member_structure(member):
    """Recursively search for note-like fields in member data"""
    note_fields = []
    
    def search_dict(d, path=""):
        for key, value in d.items():
            current_path = f"{path}.{key}" if path else key
            
            # Check if this might be a note field
            if isinstance(value, str) and key.lower() in ['note', 'notes', 'public_note', 'officer_note', 'character_note']:
                note_fields.append((current_path, value))
            
            # Recursively search dicts
            if isinstance(value, dict):
                search_dict(value, current_path)
            
            # Search lists that might contain dicts
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        search_dict(item, f"{current_path}[{i}]")
    
    search_dict(member)
    return note_fields

def test_note_parsing(note_text):
    """Test different regex patterns for detecting mains/alts"""
    print(f"\nTesting note parsing for: '{note_text}'")
    
    # Convert to lowercase for case-insensitive matching
    note_lower = note_text.lower()
    
    # Test for alt keywords
    alt_keywords = ['alt', 'alternative', 'twink']
    is_alt = any(keyword in note_lower for keyword in alt_keywords)
    print(f"Alt detection: {is_alt} (keywords: {alt_keywords})")
    
    # Test for main keywords
    main_keywords = ['main', 'primary']
    is_main = any(keyword in note_lower for keyword in main_keywords) and not is_alt
    print(f"Main detection: {is_main} (keywords: {main_keywords})")
    
    # Test main name extraction if this is an alt
    if is_alt:
        main_patterns = [
            r'alt\s+of\s+([a-zA-Z]+)',
            r'alt[:\s]+([a-zA-Z]+)',
            r'alt[-_]\s*([a-zA-Z]+)',
            r'([a-zA-Z]+)[\'']s\s+alt',
            r'([a-zA-Z]+)\s+alt'
        ]
        
        print("Testing main name extraction patterns:")
        for pattern in main_patterns:
            match = re.search(pattern, note_lower)
            if match:
                main_name = match.group(1).strip().capitalize()
                print(f"  ✓ Pattern '{pattern}' found main: {main_name}")
            else:
                print(f"  ✗ Pattern '{pattern}' found no match")
    
    return {
        'is_alt': is_alt,
        'is_main': is_main
    }

def main():
    print("🔍 Guild Notes Debug Utility")
    
    # Parse command line arguments
    guild = sys.argv[1] if len(sys.argv) > 1 else "Shadow Company"
    realm = sys.argv[2] if len(sys.argv) > 2 else "Area 52"
    region = sys.argv[3] if len(sys.argv) > 3 else "us"
    
    print(f"Analyzing guild notes for {guild} on {realm}-{region}...")
    
    # Create debug directory
    debug_dir = "debug_output"
    os.makedirs(debug_dir, exist_ok=True)
    
    # API credentials
    CLIENT_ID = "3298680df4b94d1ca55beeaf7643951d"
    CLIENT_SECRET = "efEB89iv5bBsgZLY6hoqXRiijcvAVQdE"
    
    try:
        # Initialize fetcher
        fetcher = WoWGuildFetcher(CLIENT_ID, CLIENT_SECRET, guild, realm, region)
        
        # Get guild roster
        print("Fetching guild roster...")
        roster = fetcher.get_guild_roster()
        print(f"Found {len(roster.get('members', []))} members")
        
        # Save raw roster
        with open(os.path.join(debug_dir, "raw_roster.json"), "w", encoding="utf-8") as f:
            json.dump(roster, f, indent=2)
        
        # Find all top-level keys in member objects
        if 'members' in roster and roster['members']:
            all_keys = set()
            for member in roster['members']:
                all_keys.update(member.keys())
            
            print("\nTop-level member keys found:")
            for key in sorted(all_keys):
                print(f"  - {key}")
        
        # Analyze the first few members to find notes
        if 'members' in roster and roster['members']:
            print("\nAnalyzing first 5 members for note fields:")
            for i, member in enumerate(roster['members'][:5]):
                print(f"\nMember {i}: {member.get('character', {}).get('name', 'Unknown')}")
                
                # Find all possible note fields
                note_fields = analyze_member_structure(member)
                
                if note_fields:
                    print("  Found potential note fields:")
                    for path, value in note_fields:
                        print(f"  - {path}: '{value}'")
                        # Test note parsing on this value
                        test_note_parsing(value)
                else:
                    print("  No potential note fields found")
        
        # Test different strategies for note extraction
        print("\nTesting note extraction strategies:")
        strategies = [
            ("member['note']", lambda m: m.get('note', '')),
            ("member['character_note']", lambda m: m.get('character_note', '')),
            ("member['public_note']", lambda m: m.get('public_note', '')),
            ("member['officer_note']", lambda m: m.get('officer_note', ''))
        ]
        
        for strategy_name, strategy_func in strategies:
            print(f"\nStrategy: {strategy_name}")
            notes_found = 0
            non_empty_notes = 0
            
            for member in roster.get('members', [])[:20]:  # Check first 20
                note = strategy_func(member)
                if note is not None:
                    notes_found += 1
                    if note.strip():
                        non_empty_notes += 1
                        char_name = member.get('character', {}).get('name', 'Unknown')
                        print(f"  Found non-empty note for {char_name}: '{note}'")
            
            print(f"  Found {notes_found} notes, {non_empty_notes} non-empty")
            
        print("\n🎯 Note parsing debug complete!")
        
    except Exception as e:
        print(f"❌ Error during note analysis: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
