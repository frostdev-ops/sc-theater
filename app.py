#!/usr/bin/env python3
import os
import sys
import subprocess
import json
import signal
import time
from pathlib import Path
from dotenv import load_dotenv
import click

# Configuration
APP_NAME = "shadow-company"
ENV_FILE = Path("/run/media/james/Dongus/Projects/Shadow-Company/.env")
APP_DIR = ENV_FILE.parent
PID_FILE = APP_DIR / f"{APP_NAME}.pid"
LOG_FILE = APP_DIR / f"{APP_NAME}.log"

# Ensure required directories exist
for path in [APP_DIR]:
    path.mkdir(parents=True, exist_ok=True)

def load_env():
    """Load environment variables from .env file if it exists"""
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)
    return {k: v for k, v in os.environ.items() if k}

def get_pid():
    """Get the PID from the PID file if it exists"""
    if PID_FILE.exists():
        try:
            with open(PID_FILE, 'r') as f:
                return int(f.read().strip())
        except (ValueError, IOError):
            pass
    return None

def is_running(pid):
    """Check if a process is running with the given PID"""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False

def save_pid(pid):
    """Save PID to file"""
    with open(PID_FILE, 'w') as f:
        f.write(str(pid))

def remove_pid():
    """Remove PID file"""
    if PID_FILE.exists():
        PID_FILE.unlink()

@click.group()
def cli():
    """Shadow Company Application Manager"""
    pass

@cli.command()
def start():
    """Start the application"""
    pid = get_pid()
    if pid and is_running(pid):
        click.echo(f"Application is already running (PID: {pid})")
        return

    env = load_env()
    port = env.get('PORT', '3000')
    
    # Check if port is in use
    try:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', int(port))) == 0:
                click.echo(f"Port {port} is already in use. Please stop the other process or change the PORT in .env")
                sys.exit(1)
    except Exception as e:
        click.echo(f"Warning: Could not check port {port}: {e}")

    # Start the application
    with open(LOG_FILE, 'a') as log_file:
        process = subprocess.Popen(
            ['npm', 'start'],
            cwd=str(APP_DIR),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True
        )
    
    save_pid(process.pid)
    click.echo(f"Application started with PID {process.pid}")
    click.echo(f"Logs are being written to: {LOG_FILE}")

@cli.command()
def stop():
    """Stop the application"""
    pid = get_pid()
    if not pid or not is_running(pid):
        click.echo("Application is not running")
        remove_pid()
        return

    try:
        os.kill(pid, signal.SIGTERM)
        click.echo(f"Sent SIGTERM to process {pid}")
        # Wait a bit for the process to terminate
        for _ in range(10):
            if not is_running(pid):
                break
            time.sleep(0.5)
        else:
            click.echo("Process did not terminate gracefully, forcing...")
            os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        click.echo(f"No process found with PID {pid}")
    finally:
        remove_pid()

@cli.command()
def restart():
    """Restart the application"""
    stop()
    start()

@cli.command()
def status():
    """Check application status"""
    pid = get_pid()
    if pid and is_running(pid):
        click.echo(f"Application is running (PID: {pid})")
        return 0
    else:
        click.echo("Application is not running")
        return 1

@cli.command()
@click.argument('key')
@click.argument('value', required=False)
def env(key, value):
    """Get or set environment variables"""
    env_vars = load_env()
    
    if value is None:
        # Get value
        if key in env_vars:
            click.echo(f"{key}={env_vars[key]}")
        else:
            click.echo(f"Environment variable {key} is not set")
            return 1
    else:
        # Set value
        with open(ENV_FILE, 'a+') as f:
            f.seek(0)
            lines = f.readlines()
            f.seek(0)
            f.truncate()
            
            key_found = False
            key_str = f"{key}="
            
            for line in lines:
                if line.startswith(key_str):
                    f.write(f"{key}={value}\n")
                    key_found = True
                else:
                    f.write(line)
            
            if not key_found:
                f.write(f"{key}={value}\n")
        
        click.echo(f"Set {key}={value} in {ENV_FILE}")
        
        # Suggest restart if app is running
        if status() == 0:
            click.echo("\nNote: Application is running. Run 'restart' to apply changes.")

@cli.command()
def logs():
    """View application logs"""
    if not LOG_FILE.exists():
        click.echo("No log file found")
        return

    try:
        with open(LOG_FILE, 'r') as f:
            click.echo_via_pager(f.read())
    except Exception as e:
        click.echo(f"Error reading log file: {e}")

if __name__ == '__main__':
    cli()