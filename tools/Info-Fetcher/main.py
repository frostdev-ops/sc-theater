#!/usr/bin/env python3
"""
Shadow Company Guild Data Fetcher

This script fetches information about the Shadow Company guild from the WoW API
and generates reports in different formats. It uses Google's Gemini AI to help
classify characters as mains or alts.

Usage:
  python main.py [options]

Options:
  --fetch-only       Only fetch data without generating reports
  --reports-only     Only generate reports without fetching new data
  --guild=NAME       Guild name (default: Shadow Company)
  --realm=NAME       Realm name (default: Area 52)
  --region=NAME      Region (default: us)
  --dashboard        Launch the interactive Streamlit dashboard
  --max-level-only   Only include max level characters in reports
  --active-only      Only include recently active characters in reports
  --days=DAYS        Set the number of days for "recently active" (default: 60)
  --classes=CLASSES  Filter by specific class(es), comma-separated
  --main-only        Only include main characters in reports
  --rank=RANK        Filter by specific rank(s), comma-separated
  --use-gemini       Use Gemini AI for character classification
"""

import os
import sys
import argparse
import subprocess
import webbrowser
from datetime import datetime
from wow_guild_fetcher import WoWGuildFetcher
from wow_guild_report_generator import GuildReportGenerator
from wow_guild_report import create_guild_report
import config

def parse_arguments():
    parser = argparse.ArgumentParser(description='Shadow Company Guild Data Fetcher')
    parser.add_argument('--fetch-only', action='store_true', help='Only fetch data without generating reports')
    parser.add_argument('--reports-only', action='store_true', help='Only generate reports without fetching new data')
    parser.add_argument('--guild', type=str, default='Shadow Company', help='Guild name')
    parser.add_argument('--realm', type=str, default='Duskwood', help='Realm name')
    parser.add_argument('--region', type=str, default='us', help='Region (us, eu, kr, tw)')
    parser.add_argument('--dashboard', action='store_true', help='Launch the interactive Streamlit dashboard')
    
    # New filtering arguments
    parser.add_argument('--max-level-only', action='store_true', help='Only include max level characters in reports')
    parser.add_argument('--active-only', action='store_true', help='Only include recently active characters in reports')
    parser.add_argument('--days', type=int, default=60, help='Set the number of days for "recently active" (default: 60)')
    parser.add_argument('--classes', type=str, help='Filter by specific class(es), comma-separated')
    parser.add_argument('--main-only', action='store_true', help='Only include main characters in reports')
    parser.add_argument('--rank', type=str, help='Filter by specific rank(s), comma-separated')
    parser.add_argument('--use-gemini', action='store_true', help='Use Gemini AI for character classification')
    
    # Network and runtime options
    parser.add_argument('--offline', action='store_true', help='Run in offline mode using cached data')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    parser.add_argument('--timeout', type=int, default=30, help='API request timeout in seconds (default: 30)')
    
    return parser.parse_args()

def main():
    # Parse command line arguments
    args = parse_arguments()
    
    # Load and validate configuration
    try:
        config.validate_config()
        config.print_config_info()
    except ValueError as e:
        print(f"❌ Configuration error: {str(e)}")
        sys.exit(1)
    
    # Get Gemini API key if enabled
    gemini_api_key = None
    if args.use_gemini:
        gemini_api_key = config.GEMINI_API_KEY
        if not gemini_api_key:
            print("⚠️ GEMINI_API_KEY not found in environment variables")
            print("Character classification will use fallback methods")
            print("Set the GEMINI_API_KEY environment variable to enable Gemini AI")
    
    # Create data directory if it doesn't exist
    os.makedirs('guild_data', exist_ok=True)
    os.makedirs('guild_data/reports', exist_ok=True)
    
    # Fetch data
    if not args.reports_only:
        if args.offline:
            print(f"\n📥 Loading guild data in OFFLINE mode for {args.guild} on {args.realm}-{args.region}...")
        else:
            print(f"\n📥 Fetching guild data for {args.guild} on {args.realm}-{args.region}...")
        
        # Configure logging level based on verbose flag
        import logging
        logger = logging.getLogger('wow_guild_fetcher')
        
        if args.verbose:
            logger.setLevel(logging.DEBUG)
            
            # Add a file handler for persistent logging
            log_dir = 'guild_data/logs'
            os.makedirs(log_dir, exist_ok=True)
            log_file = os.path.join(log_dir, f"guild_fetcher_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
            file_handler = logging.FileHandler(log_file)
            file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
            logger.addHandler(file_handler)
            
            print(f"🔍 Verbose logging enabled (log file: {log_file})")
        else:
            logger.setLevel(logging.INFO)
            print("ℹ️ Standard logging enabled (use --verbose for detailed logs)")
        
        try:
            fetcher = WoWGuildFetcher(
                config.BLIZZARD_CLIENT_ID, 
                config.BLIZZARD_CLIENT_SECRET, 
                args.guild or config.DEFAULT_GUILD_NAME, 
                args.realm or config.DEFAULT_REALM, 
                args.region or config.DEFAULT_REGION,
                gemini_api_key=gemini_api_key
            )
            
            # Pass offline parameter to all API methods
            print("🔍 Retrieving guild profile...")
            
            # When making API requests, pass the offline flag to use cached tokens if available
            # Get original method before monkey patching
            original_get_access_token = fetcher.get_access_token
            
            # Monkey patch the get_access_token method to always use offline mode if specified
            if args.offline:
                fetcher.get_access_token = lambda: original_get_access_token(offline_mode=True)
                print("🔄 Using cached token in offline mode")
            
            guild_profile = fetcher.get_guild_profile()
            
            if guild_profile is None:
                print("❌ Guild not found. Please check the guild name and realm.")
                if not args.dashboard:
                    sys.exit(1)
            else:
                print("👥 Retrieving guild roster...")
                guild_roster = fetcher.get_guild_roster()
                
                print("🏆 Retrieving guild achievements...")
                guild_achievements = fetcher.get_guild_achievements()
                
                print("🔄 Generating complete guild report...")
                report = create_guild_report(fetcher, 'guild_data/shadow_company_report.json')
                
                if report is None:
                    print("❌ Failed to create guild report.")
                    if not args.dashboard:
                        sys.exit(1)
                else:
                    print("✅ Data fetching complete!")
                    
        except Exception as e:
            print(f"❌ Error during data fetching: {str(e)}")
            if not args.dashboard:
                sys.exit(1)
    
    # Generate reports
    if not args.fetch_only:
        print("\n📊 Generating reports...")
        
        try:
            # Create filtering options dictionary
            filter_options = {
                'max_level_only': args.max_level_only,
                'active_only': args.active_only,
                'days_threshold': args.days,
                'classes': args.classes.split(',') if args.classes else None,
                'main_only': args.main_only,
                'ranks': args.rank.split(',') if args.rank else None
            }
            
            generator = GuildReportGenerator(filter_options=filter_options)
            reports = generator.generate_all_reports()
            
            if reports['html']:
                print(f"📄 HTML Report: {reports['html']}")
                # Open the HTML report in the default browser if it exists
                webbrowser.open(f"file://{os.path.abspath(reports['html'])}")
            else:
                print("❌ HTML report could not be generated.")
                
            if reports['excel']:
                print(f"📊 Excel Report: {reports['excel']}")
            else:
                print("❌ Excel report could not be generated.")
                
        except Exception as e:
            print(f"❌ Error during report generation: {str(e)}")
            sys.exit(1)
    
    # Launch dashboard if requested
    if args.dashboard:
        print("\n🚀 Launching interactive dashboard...")
        
        try:
            # Create .streamlit directory if it doesn't exist
            streamlit_config_dir = '.streamlit'
            os.makedirs(streamlit_config_dir, exist_ok=True)
            
            # Create streamlit config file if it doesn't exist
            config_file = os.path.join(streamlit_config_dir, 'config.toml')
            if not os.path.exists(config_file):
                with open(config_file, 'w') as f:
                    f.write(config.get_streamlit_config())
            
            # Check if dashboard exists
            dashboard_file = "wow_guild_dashboard.py"
            if not os.path.exists(dashboard_file):
                print(f"❌ Dashboard file not found: {dashboard_file}")
                print("Please make sure the file exists in the current directory.")
                sys.exit(1)
                
            # Check if streamlit is installed
            try:
                import streamlit
                print("✅ Streamlit is installed.")
            except ImportError:
                print("❌ Streamlit is not installed. Installing now...")
                try:
                    subprocess.check_call([sys.executable, "-m", "pip", "install", "streamlit"])
                    print("✅ Streamlit installed successfully!")
                    # Need to import after installation
                    import streamlit
                except Exception as install_error:
                    print(f"❌ Failed to install Streamlit: {install_error}")
                    print("Please install it manually: pip install streamlit")
                    sys.exit(1)
            
            # Launch the dashboard
            print("🚀 Starting Streamlit dashboard...")
            dashboard_process = subprocess.Popen([sys.executable, "-m", "streamlit", "run", dashboard_file])
            
            # Check if process started successfully
            if dashboard_process.poll() is None:
                print("✅ Dashboard started! Please open your browser at http://localhost:8501")
            else:
                print("❌ Failed to start dashboard. Please try running it manually:")
                print(f"    streamlit run {dashboard_file}")
                
        except Exception as e:
            print(f"❌ Error launching dashboard: {str(e)}")
            print("Make sure Streamlit is installed: pip install streamlit")
    
    print("\n🎉 All tasks completed successfully!")

if __name__ == "__main__":
    main()
