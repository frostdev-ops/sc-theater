"""
Helper module for creating guild reports
"""
import json
import os
from datetime import datetime

def create_guild_report(fetcher, output_path):
    """
    Create a comprehensive guild report and save it to a JSON file
    
    Args:
        fetcher: WoWGuildFetcher instance
        output_path: Path to save the report JSON
        
    Returns:
        dict: The report data
    """
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Get guild profile
    guild_profile = fetcher.get_guild_profile()
    
    # Get guild roster
    roster = fetcher.get_guild_roster()
    
    # Get guild achievements
    achievements = fetcher.get_guild_achievements()
    
    # Get active members
    active_members = fetcher.get_active_members()
    
    # Create report structure
    report = {
        "guild_name": guild_profile.get("name", fetcher.guild_name),
        "realm": guild_profile.get("realm", {}).get("name", fetcher.realm),
        "faction": guild_profile.get("faction", {}).get("name", "Unknown"),
        "created_timestamp": guild_profile.get("created_timestamp", 0),
        "created_date": datetime.fromtimestamp(guild_profile.get("created_timestamp", 0)/1000).strftime('%Y-%m-%d') if guild_profile.get("created_timestamp") else "Unknown",
        "achievement_points": guild_profile.get("achievement_points", 0),
        "member_count": guild_profile.get("member_count", 0) if guild_profile else (len(roster.get("members", [])) if roster else 0),
        "active_member_count": len(active_members),
        "max_level": 80,  # Current max level in WoW
        "report_generated": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
    
    # Save report to file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    
    return report
