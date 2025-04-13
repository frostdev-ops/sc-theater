#!/usr/bin/env python3
"""
Debug utility for WoW API responses

This script helps debug the structure of API responses from the WoW API.
It fetches data and saves the raw responses to help troubleshoot issues.

Usage:
  python debug_api_responses.py [guild] [realm] [region]
"""

import json
import os
import sys
from wow_guild_fetcher import WoWGuildFetcher

def main():
    print("🔍 WoW API Response Debugger")
    
    # Parse command line arguments
    guild = sys.argv[1] if len(sys.argv) > 1 else "Shadow Company"
    realm = sys.argv[2] if len(sys.argv) > 2 else "Area 52"
    region = sys.argv[3] if len(sys.argv) > 3 else "us"
    
    print(f"Debugging API responses for {guild} on {realm}-{region}...")
    
    # Create debug directory
    debug_dir = "debug_output"
    os.makedirs(debug_dir, exist_ok=True)
    
    # API credentials
    CLIENT_ID = "3298680df4b94d1ca55beeaf7643951d"
    CLIENT_SECRET = "efEB89iv5bBsgZLY6hoqXRiijcvAVQdE"
    
    try:
        # Initialize fetcher
        fetcher = WoWGuildFetcher(CLIENT_ID, CLIENT_SECRET, guild, realm, region)
        
        # Fetch and save guild profile
        print("Fetching guild profile...")
        profile = fetcher.get_guild_profile()
        with open(os.path.join(debug_dir, "guild_profile_raw.json"), "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2)
        print(f"✅ Guild profile saved to {os.path.join(debug_dir, 'guild_profile_raw.json')}")
        
        # Fetch and save guild roster
        print("Fetching guild roster...")
        roster = fetcher.get_guild_roster()
        with open(os.path.join(debug_dir, "guild_roster_raw.json"), "w", encoding="utf-8") as f:
            json.dump(roster, f, indent=2)
        print(f"✅ Guild roster saved to {os.path.join(debug_dir, 'guild_roster_raw.json')}")
        
        # Get and save a sample character's data
        if roster and "members" in roster and len(roster["members"]) > 0:
            try:
                # Get first character from roster
                first_member = roster["members"][0]
                char_name = first_member["character"]["name"]
                
                # Get character profile
                print(f"Fetching character profile for {char_name}...")
                char_profile = fetcher.get_character_profile(char_name)
                with open(os.path.join(debug_dir, f"character_{char_name}_raw.json"), "w", encoding="utf-8") as f:
                    json.dump(char_profile, f, indent=2)
                print(f"✅ Character profile saved to {os.path.join(debug_dir, f'character_{char_name}_raw.json')}")
            except Exception as e:
                print(f"❌ Error getting character data: {e}")
        
        # Fetch and save guild achievements
        print("Fetching guild achievements...")
        achievements = fetcher.get_guild_achievements()
        with open(os.path.join(debug_dir, "guild_achievements_raw.json"), "w", encoding="utf-8") as f:
            json.dump(achievements, f, indent=2)
        print(f"✅ Guild achievements saved to {os.path.join(debug_dir, 'guild_achievements_raw.json')}")
        
        # Analyze achievements structure for raid data
        print("\nAnalyzing achievements structure for raid data:")
        if isinstance(achievements, dict):
            print(f"Top-level keys: {list(achievements.keys())}")
            
            if "categories" in achievements:
                print("\nCategories found:")
                for i, category in enumerate(achievements["categories"]):
                    cat_name = category.get("name", "Unknown")
                    print(f"  {i+1}. {cat_name}")
                    if "Raid" in cat_name:
                        print(f"    - Found raid category: {cat_name}")
                        print(f"    - Contains {len(category.get('achievements', []))} achievements")
            
            if "achievements" in achievements:
                if isinstance(achievements["achievements"], dict) and "categories" in achievements["achievements"]:
                    print("\nNested categories found:")
                    for i, category in enumerate(achievements["achievements"]["categories"]):
                        cat_name = category.get("name", "Unknown")
                        print(f"  {i+1}. {cat_name}")
        
        print("\n🎉 Debug information saved successfully!")
        
    except Exception as e:
        print(f"❌ Error during debugging: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
