## 1. Add Credential Functionality
   Investiage the automation test  for this extension

## 2. Add Credential Functionality

Enhance the **Add Credential** functionality by allowing users to input and save credentials with more detailed information. This includes:

- Make the changes to the add credential icon dynamic (+) so that its hould be changed to cancel icon when its clicked and used icon class instead of the actual hardcoded symbol
- Adding validation checks for all input fields (e.g., environment, username, password, SSO URL).
- Ensuring unique credential names.
- Providing user feedback on successful or failed additions.
- Improvethe Add icon and when formContainer is opened then change the + icon to multiply icon and make use of  class="action-icon" for the icon
- chnage the save and cncel icon <input type="submit" value="💾" />
    <button id="cancelForm">🚫</button>

The form should be easily accessible, user-friendly, and display real-time error messages if required fields are not filled in or if there are conflicts, such as duplicate credential names.


## 3. Credential Search Functionality

Implement a **search functionality** that allows users to quickly find saved credentials. This search feature should:

- Filter the list of credentials based on the user's input in real-time.
- Support partial matches and be case-insensitive.
- Allow users to search by credential name, environment, or any other relevant metadata.

The search bar should be prominently placed, and the results should update dynamically as the user types.

## 4. Import and Export Functionality

Add **import and export functionalities** to allow users to back up and restore their saved credentials. This includes:

- Exporting credentials as a JSON file, including all relevant details (e.g., credential name, environment, username, password, SSO URL, favicon color).
- Providing an import function where users can upload a JSON file to restore their credentials.
- Implementing error handling for incorrect formats or duplicate entries.

The UI should include clear instructions and feedback messages to guide users through the process.
