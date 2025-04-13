#!/usr/bin/env python3
"""
Shadow Company Guild Manager - CLI Tool

A command-line interface for the Shadow Company Guild Manager with additional features.

Usage:
  python shadow_cli.py [command] [options]

Commands:
  fetch             Fetch guild data from the WoW API
  report            Generate reports from guild data
  dashboard         Launch the interactive Streamlit dashboard
  discord setup     Configure Discord webhook
  discord send      Send a message to Discord
  discord raid      Send a raid reminder to Discord
  discord m+        Send a Mythic+ announcement to Discord
  help              Display this help message
"""

import os
import sys
import argparse
import subprocess
import webbrowser
from datetime import datetime
from wow_guild_fetcher import WoWGuildFetcher
from wow_guild_report_generator import GuildReportGenerator
from discord_integration import DiscordIntegration

def parse_arguments():
    parser = argparse.ArgumentParser(description='Shadow Company Guild Manager')
    
    # Main command
    subparsers = parser.add_subparsers(dest='command', help='Command to execute')
    
    # Fetch command
    fetch_parser = subparsers.add_parser('fetch', help='Fetch guild data from the WoW API')
    fetch_parser.add_argument('--guild', type=str, default='Shadow Company', help='Guild name')
    fetch_parser.add_argument('--realm', type=str, default='Area 52', help='Realm name')
    fetch_parser.add_argument('--region', type=str, default='us', help='Region (us, eu, kr, tw)')
    fetch_parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    fetch_parser.add_argument('--offline', action='store_true', help='Run in offline mode using cached data')
    
    # Report command
    report_parser = subparsers.add_parser('report', help='Generate reports from guild data')
    report_parser.add_argument('--format', type=str, choices=['html', 'excel', 'all'], default='all', 
                              help='Report format to generate')
    report_parser.add_argument('--open', action='store_true', help='Open the report after generation')
    
    # Dashboard command
    dashboard_parser = subparsers.add_parser('dashboard', help='Launch the interactive Streamlit dashboard')
    
    # Discord commands
    discord_parser = subparsers.add_parser('discord', help='Discord integration commands')
    discord_subparsers = discord_parser.add_subparsers(dest='discord_command', help='Discord command to execute')
    
    # Discord setup command
    discord_setup_parser = discord_subparsers.add_parser('setup', help='Configure Discord webhook')
    discord_setup_parser.add_argument('--webhook', type=str, required=True, help='Discord webhook URL')
    
    # Discord send command
    discord_send_parser = discord_subparsers.add_parser('send', help='Send a message to Discord')
    discord_send_parser.add_argument('--message', type=str, required=True, help='Message to send')
    discord_send_parser.add_argument('--username', type=str, default='Shadow Company Bot', help='Bot username')
    
    # Discord raid command
    discord_raid_parser = discord_subparsers.add_parser('raid', help='Send a raid reminder to Discord')
    discord_raid_parser.add_argument('--day', type=str, default='Tuesday', help='Raid day')
    discord_raid_parser.add_argument('--time', type=str, default='8:30PM-10:30PM EST', help='Raid time')
    discord_raid_parser.add_argument('--raid', type=str, default='Heroic Liberation of Undermine', help='Raid name')
    
    # Discord M+ command
    discord_mplus_parser = discord_subparsers.add_parser('m+', help='Send a Mythic+ announcement to Discord')
    discord_mplus_parser.add_argument('--day', type=str, default='Saturday', help='Event day')
    discord_mplus_parser.add_argument('--time', type=str, default='7:00PM-10:00PM EST', help='Event time')
    discord_mplus_parser.add_argument('--desc', type=str, default='Weekly M+ key pushes', help='Event description')
    
    return parser.parse_args()

def print_header():
    """Print stylish header"""
    print("\n" + "=" * 60)
    print("🌑✨ SHADOW COMPANY GUILD MANAGER ✨🌑".center(60))
    print("Where We Wipe on Trash But Still Somehow Kill Bosses".center(60))
    print("=" * 60 + "\n")

def fetch_data(args):
    """Fetch guild data from the WoW API"""
    if args.offline:
        print(f"📥 Loading guild data in OFFLINE mode for {args.guild} on {args.realm}-{args.region}...")
    else:
        print(f"📥 Fetching guild data for {args.guild} on {args.realm}-{args.region}...")
    
    # Configure logging level based on verbose flag
    import logging
    # Import the setup_logging function from wow_guild_fetcher
    from wow_guild_fetcher import setup_logging
    
    if args.verbose:
        # Use the improved logger setup function
        logger = setup_logging(log_level=logging.DEBUG)
        log_dir = os.path.join('guild_data', 'logs')
        # Find the most recent log file to display to the user
        logs = [f for f in os.listdir(log_dir) if f.startswith('wow_guild_fetcher_')]
        if logs:
            latest_log = sorted(logs)[-1]
            log_file = os.path.join(log_dir, latest_log)
            print(f"🔍 Verbose logging enabled (log file: {log_file})")
            print(f"📝 Detailed debug information will be logged")
        else:
            print(f"🔍 Verbose logging enabled")
    else:
        # Standard logging level
        logger = setup_logging(log_level=logging.INFO)
        print(f"ℹ️ Standard logging enabled (use --verbose for detailed logs)")
    
    # API credentials
    CLIENT_ID = "3298680df4b94d1ca55beeaf7643951d"
    CLIENT_SECRET = "efEB89iv5bBsgZLY6hoqXRiijcvAVQdE"
    
    # Create data directory if it doesn't exist
    os.makedirs('guild_data', exist_ok=True)
    
    try:
        # Initialize fetcher with Gemini API key if available
        from config import GEMINI_API_KEY
        gemini_api_key = GEMINI_API_KEY if os.environ.get('GEMINI_API_KEY') else None
        
        fetcher = WoWGuildFetcher(CLIENT_ID, CLIENT_SECRET, args.guild, args.realm, args.region, 
                                 gemini_api_key=gemini_api_key)
        
        # Save original method for monkey patching
        original_get_access_token = fetcher.get_access_token
        
        # Monkey patch get_access_token for offline mode
        if args.offline:
            print("🔄 Using cached token in offline mode")
            fetcher.get_access_token = lambda: original_get_access_token(offline_mode=True)
        
        print("🔍 Retrieving guild profile...")
        guild_profile = fetcher.get_guild_profile()
        
        print("👥 Retrieving guild roster...")
        guild_roster = fetcher.get_guild_roster()
        
        print("🏆 Retrieving guild achievements...")
        guild_achievements = fetcher.get_guild_achievements()
        
        print("🔄 Generating complete guild report...")
        report = fetcher.create_guild_report()
        
        print("✅ Data fetching complete!")
        return True
        
    except Exception as e:
        print(f"❌ Error during data fetching: {str(e)}")
        return False

def generate_reports(args):
    """Generate reports from guild data"""
    print("📊 Generating reports...")
    
    try:
        generator = GuildReportGenerator()
        
        if args.format == 'html' or args.format == 'all':
            html_report = generator.generate_html_report()
            print(f"📄 HTML Report: {html_report}")
            
            if args.open:
                webbrowser.open(f"file://{os.path.abspath(html_report)}")
        
        if args.format == 'excel' or args.format == 'all':
            excel_report = generator.generate_excel_report()
            print(f"📊 Excel Report: {excel_report}")
        
        print("✅ Report generation complete!")
        return True
        
    except Exception as e:
        print(f"❌ Error during report generation: {str(e)}")
        return False

def launch_dashboard():
    """Launch the interactive Streamlit dashboard"""
    print("🚀 Launching interactive dashboard...")
    
    try:
        # Check if streamlit is installed
        try:
            import streamlit
        except ImportError:
            print("❌ Streamlit is not installed. Please install it with: pip install streamlit")
            return False
        
        # Launch the Streamlit dashboard
        subprocess.Popen(["streamlit", "run", "wow_guild_dashboard.py"])
        print("✅ Dashboard launched! If it doesn't open automatically, please navigate to http://localhost:8501")
        return True
        
    except Exception as e:
        print(f"❌ Error launching dashboard: {str(e)}")
        return False

def discord_setup(args):
    """Configure Discord webhook"""
    print("🔧 Configuring Discord webhook...")
    
    try:
        discord = DiscordIntegration()
        discord.set_webhook_url(args.webhook)
        print("✅ Discord webhook configured successfully!")
        
        # Send test message
        print("🔄 Sending test message to Discord...")
        success = discord.send_message(
            "👋 Hello from Shadow Company Guild Manager! Discord integration is now configured.",
            username="Shadow Company Setup"
        )
        
        if success:
            print("✅ Test message sent successfully!")
        else:
            print("❌ Failed to send test message. Please check the webhook URL.")
        
        return success
        
    except Exception as e:
        print(f"❌ Error configuring Discord webhook: {str(e)}")
        return False

def discord_send(args):
    """Send a message to Discord"""
    print("📤 Sending message to Discord...")
    
    try:
        discord = DiscordIntegration()
        success = discord.send_message(
            content=args.message,
            username=args.username
        )
        
        if success:
            print("✅ Message sent successfully!")
        else:
            print("❌ Failed to send message. Please check the Discord configuration.")
        
        return success
        
    except Exception as e:
        print(f"❌ Error sending message to Discord: {str(e)}")
        return False

def discord_raid(args):
    """Send a raid reminder to Discord"""
    print("📤 Sending raid reminder to Discord...")
    
    try:
        discord = DiscordIntegration()
        success = discord.send_raid_reminder(
            day=args.day,
            time=args.time,
            raid_name=args.raid
        )
        
        if success:
            print("✅ Raid reminder sent successfully!")
        else:
            print("❌ Failed to send raid reminder. Please check the Discord configuration.")
        
        return success
        
    except Exception as e:
        print(f"❌ Error sending raid reminder to Discord: {str(e)}")
        return False

def discord_mplus(args):
    """Send a Mythic+ announcement to Discord"""
    print("📤 Sending Mythic+ announcement to Discord...")
    
    try:
        discord = DiscordIntegration()
        success = discord.send_mythic_plus_announcement(
            day=args.day,
            time=args.time,
            description=args.desc
        )
        
        if success:
            print("✅ Mythic+ announcement sent successfully!")
        else:
            print("❌ Failed to send Mythic+ announcement. Please check the Discord configuration.")
        
        return success
        
    except Exception as e:
        print(f"❌ Error sending Mythic+ announcement to Discord: {str(e)}")
        return False

def main():
    """Main function"""
    args = parse_arguments()
    print_header()
    
    if args.command == 'fetch':
        fetch_data(args)
    
    elif args.command == 'report':
        generate_reports(args)
    
    elif args.command == 'dashboard':
        launch_dashboard()
    
    elif args.command == 'discord':
        if args.discord_command == 'setup':
            discord_setup(args)
        
        elif args.discord_command == 'send':
            discord_send(args)
        
        elif args.discord_command == 'raid':
            discord_raid(args)
        
        elif args.discord_command == 'm+':
            discord_mplus(args)
        
        else:
            print("❌ Unknown Discord command. Use 'python shadow_cli.py help' for available commands.")
    
    elif args.command == 'help' or args.command is None:
        # Print help text
        print(__doc__)
    
    else:
        print(f"❌ Unknown command: {args.command}")
        print("Use 'python shadow_cli.py help' for available commands.")
    
    print("\n🎉 Operation completed!\n")

if __name__ == "__main__":
    main()
