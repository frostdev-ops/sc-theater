import requests
import json
import os
from datetime import datetime

class DiscordIntegration:
    def __init__(self, webhook_url=None):
        """
        Initialize Discord integration
        
        Args:
            webhook_url (str, optional): Discord webhook URL. If None, will try to load from config file.
        """
        self.webhook_url = webhook_url
        self.config_file = 'guild_data/discord_config.json'
        
        # Load webhook URL from config if not provided
        if not self.webhook_url:
            self._load_config()
    
    def _load_config(self):
        """Load Discord configuration from file"""
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                    self.webhook_url = config.get('webhook_url')
            else:
                print(f"Discord config file not found: {self.config_file}")
        except Exception as e:
            print(f"Error loading Discord config: {str(e)}")
    
    def _save_config(self):
        """Save Discord configuration to file"""
        try:
            os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump({'webhook_url': self.webhook_url}, f, indent=2)
            print(f"Discord config saved to {self.config_file}")
        except Exception as e:
            print(f"Error saving Discord config: {str(e)}")
    
    def set_webhook_url(self, webhook_url):
        """
        Set Discord webhook URL and save to config
        
        Args:
            webhook_url (str): Discord webhook URL
        """
        self.webhook_url = webhook_url
        self._save_config()
        return True
    
    def send_message(self, content, username="Shadow Company Bot", avatar_url=None, embeds=None):
        """
        Send a message to Discord
        
        Args:
            content (str): Message content
            username (str, optional): Bot username. Defaults to "Shadow Company Bot".
            avatar_url (str, optional): URL for bot avatar. Defaults to None.
            embeds (list, optional): List of Discord embeds. Defaults to None.
        
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.webhook_url:
            print("Error: No Discord webhook URL configured")
            return False
        
        payload = {
            "content": content,
            "username": username
        }
        
        if avatar_url:
            payload["avatar_url"] = avatar_url
        
        if embeds:
            payload["embeds"] = embeds
        
        try:
            response = requests.post(
                self.webhook_url,
                json=payload
            )
            
            if response.status_code == 204:
                print("Message sent to Discord successfully")
                return True
            else:
                print(f"Error sending message to Discord: {response.status_code}")
                print(response.text)
                return False
                
        except Exception as e:
            print(f"Error sending message to Discord: {str(e)}")
            return False
    
    def send_guild_report(self, guild_data):
        """
        Send a guild report to Discord
        
        Args:
            guild_data (dict): Guild data from WoW Guild Fetcher
        
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.webhook_url:
            print("Error: No Discord webhook URL configured")
            return False
        
        try:
            # Basic guild info
            guild_name = guild_data.get('guild_name', 'Shadow Company')
            realm = guild_data.get('realm', 'Unknown')
            faction = guild_data.get('faction', 'Unknown')
            member_count = guild_data.get('member_count', 0)
            active_count = len(guild_data.get('active_members', []))
            
            # Calculate raid progress
            raid_progress = {}
            completed_raids = 0
            total_raids = 0
            
            for category, achievements in guild_data.get('raid_progress', {}).items():
                category_completed = sum(1 for a in achievements if a.get('completed', False))
                category_total = len(achievements)
                
                if category_total > 0:
                    progress_pct = int((category_completed / category_total) * 100)
                else:
                    progress_pct = 0
                
                raid_progress[category] = {
                    'completed': category_completed,
                    'total': category_total,
                    'percent': progress_pct
                }
                
                completed_raids += category_completed
                total_raids += category_total
            
            # Calculate overall raid progress
            if total_raids > 0:
                overall_progress = int((completed_raids / total_raids) * 100)
            else:
                overall_progress = 0
            
            # Create message content
            content = f"**🌑✨ {guild_name} Guild Report ✨🌑**"
            
            # Create embeds
            embeds = [
                {
                    "title": f"{guild_name} - {realm} ({faction})",
                    "color": 3447003,  # Blue color
                    "fields": [
                        {
                            "name": "Guild Overview",
                            "value": f"👥 **Members:** {member_count}\n"
                                    f"⚡ **Active Members:** {active_count}\n"
                                    f"🏆 **Achievement Points:** {guild_data.get('achievement_points', 0)}\n"
                                    f"📅 **Created:** {guild_data.get('created_date', 'Unknown')}"
                        },
                        {
                            "name": "Raid Progress",
                            "value": f"Overall Progress: {overall_progress}% ({completed_raids}/{total_raids})"
                        }
                    ],
                    "footer": {
                        "text": f"Report generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                    }
                }
            ]
            
            # Add individual raid progress
            for category, progress in raid_progress.items():
                embeds.append({
                    "title": f"Raid Progress: {category}",
                    "color": 15105570,  # Gold color
                    "description": f"**{progress['completed']}/{progress['total']} "
                                  f"({progress['percent']}%)**"
                })
            
            # Add class distribution if available
            if guild_data.get('roster'):
                class_counts = {}
                for member in guild_data.get('roster', []):
                    try:
                        character = member['character']
                        class_name = character.get('playable_class', {}).get('name', 'Unknown')
                        
                        if class_name in class_counts:
                            class_counts[class_name] += 1
                        else:
                            class_counts[class_name] = 1
                    except:
                        continue
                
                class_distribution = "\n".join([
                    f"**{class_name}:** {count}" 
                    for class_name, count in sorted(class_counts.items(), key=lambda x: x[1], reverse=True)
                ])
                
                embeds.append({
                    "title": "Class Distribution",
                    "color": 3066993,  # Green color
                    "description": class_distribution
                })
            
            # Send the message
            return self.send_message(
                content=content, 
                username="Shadow Company Reporter", 
                embeds=embeds
            )
            
        except Exception as e:
            print(f"Error creating guild report for Discord: {str(e)}")
            return False
    
    def send_raid_reminder(self, day, time, raid_name="Heroic Liberation of Undermine"):
        """
        Send a raid reminder to Discord
        
        Args:
            day (str): Day of the raid (e.g., "Tuesday")
            time (str): Time of the raid (e.g., "8:30PM-10:30PM EST")
            raid_name (str, optional): Name of the raid. Defaults to "Heroic Liberation of Undermine".
        
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.webhook_url:
            print("Error: No Discord webhook URL configured")
            return False
        
        content = f"@everyone **RAID REMINDER**"
        
        embeds = [
            {
                "title": f"🔥 {raid_name} 🔥",
                "color": 15158332,  # Red color
                "description": f"Don't forget our raid tonight!\n\n"
                              f"**Day:** {day}\n"
                              f"**Time:** {time}\n\n"
                              f"Please be online 15 minutes early to get buffs and consumables ready.\n"
                              f"*Where We Wipe on Trash But Still Somehow Kill Bosses*",
                "footer": {
                    "text": "Reply with a thumbs up if you're attending!"
                }
            }
        ]
        
        return self.send_message(
            content=content,
            username="Shadow Company Raid Master",
            embeds=embeds
        )
    
    def send_mythic_plus_announcement(self, day, time, description="Weekly M+ key pushes"):
        """
        Send a Mythic+ announcement to Discord
        
        Args:
            day (str): Day of the event (e.g., "Saturday")
            time (str): Time of the event (e.g., "7:00PM-10:00PM EST")
            description (str, optional): Description of the event. Defaults to "Weekly M+ key pushes".
        
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.webhook_url:
            print("Error: No Discord webhook URL configured")
            return False
        
        content = f"@here **MYTHIC+ EVENT**"
        
        embeds = [
            {
                "title": f"🔑 Mythic+ Keys 🔑",
                "color": 10181046,  # Purple color
                "description": f"{description}\n\n"
                              f"**Day:** {day}\n"
                              f"**Time:** {time}\n\n"
                              f"Reply below with your character name, key level, and dungeon if you have a key to run!\n"
                              f"*Guys, I swear this route works in MDT*",
                "footer": {
                    "text": "Remember to bring your own Augmentation Runes"
                }
            }
        ]
        
        return self.send_message(
            content=content,
            username="Shadow Company M+ Coordinator",
            embeds=embeds
        )


# Example usage
if __name__ == "__main__":
    # Initialize Discord integration
    discord = DiscordIntegration()
    
    # Set webhook URL (replace with your actual Discord webhook URL)
    # discord.set_webhook_url("https://discord.com/api/webhooks/your_webhook_url_here")
    
    # Send a test message
    discord.send_message("This is a test message from the Shadow Company Guild Tool!")
    
    # Send a raid reminder
    discord.send_raid_reminder("Tuesday", "8:30PM-10:30PM EST")
    
    # Send a Mythic+ announcement
    discord.send_mythic_plus_announcement("Saturday", "7:00PM-10:00PM EST")