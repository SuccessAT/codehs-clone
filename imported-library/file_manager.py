from typing import Dict, List, Any, Optional, Callable, Union
import base64
import os
import tarfile
import io
import asyncio
from e2b import AsyncSandbox, FilesystemEvent
from e2b.sandbox.filesystem.filesystem import FileType
# from e2b.sandbox.commands.command_handle import OutputHandler


class FileManager:
    """Manages files and folders within a sandbox environment"""
    
    def __init__(self, sandbox: AsyncSandbox, file_watch_callback: Optional[Callable] = None):
        self.sandbox = sandbox
        self.file_watch_callback = file_watch_callback
        self.watchers = []
        self.project_dir = "/home/user/project"
        
    async def initialize(self):
        """Initialize the file manager and set up watchers"""
        # Set up a file watcher for the project directory
        try:
            # Ensure project directory exists
            await self.sandbox.files.make_dir(path=self.project_dir)
            
            # Watch the project directory for file changes
            def on_file_event(event: FilesystemEvent):
                # Call the async callback using create_task to avoid blocking
                import asyncio
                asyncio.create_task(self._on_file_changed(event))
            
            watcher = await self.sandbox.files.watch_dir(
                path=self.project_dir,
                on_event=on_file_event,
                recursive=True  # Watch subdirectories too
            )
            self.watchers.append(watcher)
            
            # If a callback was provided, send initial file structure
            if self.file_watch_callback:
                files = await self.get_file_tree()
                await self.file_watch_callback(files)
        except Exception as e:
            print(f"Error initializing file manager: {e}")
    
    # async def _on_file_changed(self, change_event: FilesystemEvent):
    #     """Handle file change events from the watcher"""
    #     if self.file_watch_callback:
    #         files = await self.get_file_tree()
    #         await self.file_watch_callback(files)
    
    async def _on_file_changed(self, change_event: FilesystemEvent):
        """Handle file change events from the watcher"""
        if self.file_watch_callback:
            files = await self.get_file_tree()
            
            # Check if callback is a coroutine function (async) or regular function
            if asyncio.iscoroutinefunction(self.file_watch_callback):
                await self.file_watch_callback(files)
            else:
                # Call regular function without await
                self.file_watch_callback(files)

    async def get_file(self, file_id: str) -> Dict[str, Any]:
        """Get the content of a file by ID"""
        try:
            # Check if file exists
            if not await self.sandbox.files.exists(path=file_id):
                return None
            
            # Read file content as text
            content = await self.sandbox.files.read(path=file_id, format="text")
            
            return {
                "id": file_id,
                "name": os.path.basename(file_id),
                "type": "file",
                "body": content,
                "parent": os.path.dirname(file_id)
            }
        except Exception as e:
            print(f"Error getting file {file_id}: {e}")
            return None
        
    async def get_folder(self, folder_id: str) -> Dict[str, Any]:
        """Get the contents of a folder by ID"""
        try:
            # Check if directory exists
            if not await self.sandbox.files.exists(path=folder_id):
                return None
            
            # List entries in directory
            entries = await self.sandbox.files.list(path=folder_id)
            children = []
            
            for entry in entries:
                entry_path = os.path.join(folder_id, entry.name)
                entry_path = entry_path.replace('\\', '/')
                # Check if entry is directory by comparing the type attribute
            
                if entry.type == FileType.DIR:
                    children.append({
                        "id": entry_path,
                        "name": entry.name,
                        "type": "folder",
                        "children": []
                    })
                elif entry.type == FileType.FILE:
                    children.append({
                        "id": entry_path,
                        "name": entry.name,
                        "type": "file"
                    })
            
            return {
                "id": folder_id,
                "name": os.path.basename(folder_id) or "project",
                "type": "folder",
                "children": children
            }
        except Exception as e:
            print(f"Error getting folder {folder_id}: {e}")
            return None
        
    async def save_file(self, file_id: str, content: str) -> bool:
        """Save content to a file"""
        try:
            await self.sandbox.files.write(file_id, content)
            return True
        except Exception as e:
            print(f"Error saving file {file_id}: {e}")
            return False
        
    async def create_file(self, parent_path: str, name: str) -> bool:
        """Create a new file in the specified parent directory"""
        try:
            # Create the file path by joining parent path and name
            file_path = os.path.join(parent_path, name).replace('\\', '/')
            print("file_path", file_path)
            
            # Create the file with empty content
            await self.sandbox.files.write(file_path, "")
            
            # Verify the file was created by checking if it exists
            file_exists = await self.sandbox.files.exists(path=file_path)
            
            if file_exists:
                print(f"Successfully created file: {file_path}")
                
                # Optional: List the directory contents to confirm
                parent_files = await self.sandbox.files.list(path=parent_path)
                print(f"Files in {parent_path}:")
                for file in parent_files:
                    print(f"  - {file.name} ({file.type})")
                    
                return True
            else:
                print(f"File creation failed: {file_path} does not exist after write operation")
                return False
                
        except Exception as e:
            print(f"Error creating file {name} in {parent_path}: {e}")
            return False
        
    async def create_folder(self, parent_path: str, name: str) -> bool:
        """Create a new folder in the specified parent directory"""
        try:
            # Create the folder path by joining parent path and name
            folder_path = os.path.join(parent_path, name)
            folder_path = folder_path.replace('\\', '/')
            
            # Create the directory
            created = await self.sandbox.files.make_dir(
                path=folder_path
            )
            return created
        except Exception as e:
            print(f"Error creating folder {name} in {parent_path}: {e}")
            return False
        
    async def rename_file(self, file_id: str, new_name: str) -> bool:
        """Rename a file or directory"""
        try:
            # Get the directory part of the file path
            directory = os.path.dirname(file_id)
            # Create the new path with the new name
            new_path = os.path.join(directory, new_name)
            new_path = new_path.replace('\\', '/')
            
            # Rename the file or directory
            await self.sandbox.files.rename(
                old_path=file_id,
                new_path=new_path
            )
            return True
        except Exception as e:
            print(f"Error renaming {file_id} to {new_name}: {e}")
            return False
        
    async def delete_file(self, file_id: str) -> bool:
        """Delete a file or directory"""
        try:
            await self.sandbox.files.remove(
                path=file_id
            )
            return True
        except Exception as e:
            print(f"Error deleting {file_id}: {e}")
            return False
        
    async def get_file_tree(self) -> List[Dict[str, Any]]:
        """Get the complete file tree structure"""
        try:
            # Ensure project directory exists
            if not await self.sandbox.files.exists(path=self.project_dir):
                await self.sandbox.files.make_dir(path=self.project_dir)
            
            # Get root folder structure
            root_folder = await self.get_folder(self.project_dir)
            
            # Process all folders recursively to get full tree
            async def process_folder(folder):
                for i, child in enumerate(folder.get("children", [])):
                    if child["type"] == "folder":
                        child_folder = await self.get_folder(child["id"])
                        folder["children"][i] = child_folder
                        await process_folder(folder["children"][i])
                        
            await process_folder(root_folder)
            
            # Return as list with single root
            return [root_folder]
        except Exception as e:
            print(f"Error getting file tree: {e}")
            return []
        
    async def get_files_for_download(self) -> str:
        """Get a base64-encoded tar.gz of all files"""
        try:
            # Create a tar.gz file in memory
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode='w:gz') as tar:
                # List all files recursively
                async def add_to_tar(path, arcname):
                    entries = await self.sandbox.filesystem.list(path=path)
                    for entry in entries:
                        entry_path = os.path.join(path, entry.name)
                        entry_path = entry_path.replace('\\', '/')
                        # Use the entry name for the archive name
                        entry_arcname = os.path.join(arcname, entry.name)
                        entry_arcname = entry_arcname.replace('\\', '/')
                        
                        if entry.type == FileType.DIR:
                            # Recursively add directory contents
                            await add_to_tar(entry_path, entry_arcname)
                        elif entry.type == FileType.FILE:
                            # Add file to archive
                            content = await self.sandbox.files.read(path=entry_path, format="bytes")
                            file_info = tarfile.TarInfo(entry_arcname)
                            file_info.size = len(content)
                            buf_file = io.BytesIO(content)
                            tar.addfile(file_info, buf_file)
                
                # Start the recursion from the project directory
                await add_to_tar(self.project_dir, "")
            
            # Encode as base64
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('ascii')
        except Exception as e:
            print(f"Error creating download archive: {e}")
            return ""
        
    async def close_watchers(self):
        """Close all file watchers"""
        try:
            if hasattr(self, 'watcher') and self.watcher:
                if hasattr(self.watcher, 'disconnect'):
                    await self.watcher.disconnect()
                elif hasattr(self.watcher, 'close'):
                    await self.watcher.close()
                # If neither of these methods exist, just let it go
                self.watcher = None
        except Exception as e:
            print(f"Error closing watcher: {e}")
        self.watchers = []
        
    async def move_file(self, file_id: str, folder_id: str) -> bool:
        """Move a file to a different folder"""
        try:
            # Get the filename from the file path
            filename = os.path.basename(file_id)
            # Create the new path in the destination folder
            new_path = os.path.join(folder_id, filename)
            new_path = new_path.replace('\\', '/')
            
            # Move the file (using rename functionality)
            await self.sandbox.files.rename(
                old_path=file_id,
                new_path=new_path
            )
            return True
        except Exception as e:
            print(f"Error moving file {file_id} to {folder_id}: {e}")
            return False
        
    async def upload_file(self, file_content: bytes, file_path: str) -> bool:
        """Upload a file to the specified path"""
        try:
            await self.sandbox.files.write(file_path, file_content)
            return True
        except Exception as e:
            print(f"Error uploading file to {file_path}: {e}")
            return False