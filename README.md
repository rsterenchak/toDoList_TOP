# Project and Task Manager Application

![Tests](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml/badge.svg)

## Overview

This project is a simple front-end task management application built as part of CS307 (Software Engineering). The main goal of the application is to allow users to create projects and manage tasks within those projects.

The core feature implemented is the ability to add and edit tasks, including updating task titles, descriptions, and due dates. The application is designed to be lightweight and focused on basic task organization.

---

## Live Application

You can access the deployed application here:
https://rsterenchak.github.io/toDoList_TOP/

---

## Features

* Create and manage multiple projects
* Add new tasks to a project
* Edit task titles
* Edit task descriptions
* Assign due dates to tasks
* Delete tasks
* Persist data using localStorage

---

## Technologies Used

* JavaScript (ES Modules)
* HTML
* CSS
* localStorage (for data persistence)

---

## Project Structure

* **main.js**
  Handles DOM creation, event listeners, and user interaction

* **listLogic.js**
  Manages all project and task data using the `allProjects` object

* **toDo.js**
  Factory function used to create task objects

---

## How It Works

User input is captured through the UI and handled by event listeners in `main.js`. When a task is created or updated, the data is passed into the `listLogic` module, which updates the correct project inside the `allProjects` object.

Each task is created using the `toDo` factory function, which ensures all task objects follow the same structure. After updates are made, the data is saved to `localStorage`, and the UI is re-rendered to reflect the changes.

---

## Google Drive Export Setup

The "Export to Drive" menu item requires an OAuth 2.0 Client ID provisioned in the Google Cloud Console (see the comment block at the top of `toDoList_main/src/driveExport.js` for step-by-step instructions). The Client ID is injected at build time from the `GOOGLE_OAUTH_CLIENT_ID` environment variable — it is **never** committed to source.

* **Production (GitHub Pages):** add `GOOGLE_OAUTH_CLIENT_ID` as a repository secret under *Settings → Secrets and variables → Actions*. The deploy workflow forwards it to the build step automatically.
* **Local development:** export it in your shell before `npm start`:
  ```
  export GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
  npm start
  ```
  Without the env var, the menu item appears but surfaces a "Drive export not configured for this build" toast — the rest of the app works normally.

---

## Testing

Testing was performed manually by interacting with the application. This included:

* Creating tasks
* Editing titles and descriptions
* Assigning due dates
* Deleting tasks
* Refreshing the page to verify data persistence

The application was also tested for basic edge cases such as empty inputs and duplicate task entries.

---

## Known Limitations

* No input validation for empty or duplicate tasks
* No user authentication or multi-user support
* Priority and task assignment features are not fully implemented

---

## Future Improvements

* Add input validation for task creation
* Implement task prioritization
* Add user authentication for multi-user support
* Improve UI/UX for better usability

---

## Author

Robert Sterenchak
CS307 - Software Engineering
