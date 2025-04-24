import asyncio
import logging
import uuid
import os
from typing import Dict, Any, Optional, List

from project import Project

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("main")

class ProjectManager:
    """Manages multiple project instances"""
    
    def __init__(self):
        self.projects: Dict[str, Project] = {}
        
    async def create_project(self, project_id: Optional[str] = None, project_type: str = "base") -> str:
        """Create a new project and return its ID"""
        if not project_id:
            project_id = str(uuid.uuid4())
            
        # Check if project already exists
        if project_id in self.projects:
            logger.warning(f"Project {project_id} already exists, returning existing instance")
            return project_id
            
        logger.info(f"Creating new project with ID: {project_id}, type: {project_type}")
        
        # Create new project instance
        project = Project(project_id, project_type)
        
        # Initialize the project
        async def file_watch_callback(files: List[Dict]):
            logger.info(f"Files changed in project {project_id}")
            # In a real scenario, this would emit events to connected clients
            
        initialized = await project.initialize(file_watch_callback=file_watch_callback)
        
        if initialized:
            self.projects[project_id] = project
            logger.info(f"Project {project_id} initialized successfully")
            return project_id
        else:
            logger.error(f"Failed to initialize project {project_id}")
            return None
            
    async def get_project(self, project_id: str) -> Optional[Project]:
        """Get a project by ID"""
        return self.projects.get(project_id)
        
    async def close_project(self, project_id: str) -> bool:
        """Close a project and release its resources"""
        project = self.projects.get(project_id)
        if not project:
            logger.warning(f"Project {project_id} not found for closing")
            return False
            
        try:
            await project.disconnect()
            del self.projects[project_id]
            logger.info(f"Project {project_id} closed successfully")
            return True
        except Exception as e:
            logger.error(f"Error closing project {project_id}: {str(e)}")
            return False
            
    async def close_all_projects(self):
        """Close all projects and release resources"""
        project_ids = list(self.projects.keys())
        for project_id in project_ids:
            await self.close_project(project_id)
        
        logger.info(f"All projects closed: {len(project_ids)} projects")

async def test_project_operations(project: Project):
    """Test various operations on a project"""
    # Get project details
    details = project.get_project_details()
    logger.info(f"Project details: {details}")
    
    # Create a terminal
    terminal_connection = {"socket": DummySocket()}
    handlers = project.handlers(terminal_connection)
    
    # Create terminal
    terminal_result = await handlers["createTerminal"]({"id": "test_terminal"})
    logger.info(f"Terminal created: {terminal_result}")
    
    # Create a file
    file_result = await handlers["createFile"]({
        "parentPath": project.file_manager.project_dir,
        "name": "test.py"
    })
    logger.info(f"File created: {file_result}")
    
    # Save content to the file
    save_result = await handlers["saveFile"]({
        "path": f"{project.file_manager.project_dir}/test.py",
        "content": "print('Hello from test project!')\ninput_value = input('Enter something: ')\nprint(f'You entered: {input_value}')"
    })
    logger.info(f"File saved: {save_result}")
    
    # Run the file in the terminal
    run_result = await handlers["runCommand"]({
        "command": f"python {project.file_manager.project_dir}/test.py",
        "terminalId": "test_terminal"
    })
    logger.info(f"Command run: {run_result}")
    
    # Simulate user input
    await asyncio.sleep(1)  # Wait for the program to start and prompt for input
    input_result = await handlers["terminalData"]({
        "id": "test_terminal",
        "data": "Hello from the terminal!\r"
    })
    logger.info(f"Input sent: {input_result}")
    
    # Create a folder
    folder_result = await handlers["createFolder"]({
        "parentPath": project.file_manager.project_dir,
        "name": "test_folder"
    })
    logger.info(f"Folder created: {folder_result}")
    
    # Create a file in the folder
    nested_file_result = await handlers["createFile"]({
        "parentPath": f"{project.file_manager.project_dir}/test_folder",
        "name": "nested.py"
    })
    logger.info(f"Nested file created: {nested_file_result}")
    
    # Save content to the nested file
    nested_save_result = await handlers["saveFile"]({
        "path": f"{project.file_manager.project_dir}/test_folder/nested.py",
        "content": "print('Hello from nested file!')"
    })
    logger.info(f"Nested file saved: {nested_save_result}")
    
    # Run the nested file
    nested_run_result = await handlers["runCommand"]({
        "command": f"python {project.file_manager.project_dir}/test_folder/nested.py",
        "terminalId": "test_terminal"
    })
    logger.info(f"Nested command run: {nested_run_result}")
    
    # Close the terminal
    close_result = await handlers["closeTerminal"]({"id": "test_terminal"})
    logger.info(f"Terminal closed: {close_result}")

class DummySocket:
    """A dummy socket for testing that logs emitted events"""
    async def emit(self, event, data):
        logger.info(f"Socket event '{event}' emitted with data: {data}")

async def main():
    """Run a demo of the project manager"""
    manager = ProjectManager()
    
    try:
        # Create a new project
        project_id = await manager.create_project(project_type="base")
        if not project_id:
            logger.error("Failed to create project")
            return
            
        logger.info(f"Created project: {project_id}")
        
        # Get the project instance
        project = await manager.get_project(project_id)
        if not project:
            logger.error(f"Failed to get project {project_id}")
            return
            
        # Test project operations
        await test_project_operations(project)
        
        # Allow some time for async operations to complete
        await asyncio.sleep(2)
        
    finally:
        # Clean up all resources
        await manager.close_all_projects()

if __name__ == "__main__":
    asyncio.run(main())