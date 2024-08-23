document.addEventListener("DOMContentLoaded", function () {
  // 1. Define the formContainer element where forms will be rendered.
  const formContainer = document.getElementById("formContainer");

  // 2. Check if formContainer exists in the DOM.
  if (!formContainer) {
    console.error("formContainer is not available.");
    return;
  }

  // 3. Retrieve saved credentials from localStorage.
  const savedCredentials =
    JSON.parse(localStorage.getItem("credentials")) || [];

  // 4. Load the saved credentials into the formContainer.
  loadCredentials(savedCredentials, formContainer);

  // 5. Add an event listener to the "New Credential" button to show the form.
  const newCredentialButton = document.getElementById("newCredentialButton");
  if (newCredentialButton) {
    newCredentialButton.addEventListener("click", () => {
      formContainer.style.display = "block";
      formContainer.style.width = "150px";
      showNewCredentialForm(savedCredentials, formContainer);
    });
  } else {
    console.error("newCredentialButton is not available.");
  }
});

// 6. Function to handle login to Salesforce using different methods (new tab, new window, incognito).
const loginToSalesforce = async (credential, loginType) => {
  // 7. Define the Salesforce URL based on the selected environment.
  let salesforceURL;
  switch (credential.environment) {
    case "sandbox":
      salesforceURL = "https://test.salesforce.com/";
      break;
    case "production":
      salesforceURL = "https://login.salesforce.com/";
      break;
    case "sso":
      salesforceURL = credential.ssourl; // Update URL for SSO.
      break;
    default:
      salesforceURL = "https://test.salesforce.com/";
  }

  // 8. Define a removable listener to handle newly created tabs.
  const removableListener = async (tab) => {
    if (tab.url.startsWith(salesforceURL)) {
      await setOnCreatedListener(tab.id, credential);
      await setOnUpdatedListener(tab.id, credential);
      chrome.tabs.onCreated.removeListener(removableListener);
    }
  };

  // 9. Listener to execute login script when a new tab is created.
  const setOnCreatedListener = async (tabId, credential) => {
    const tab = await chrome.tabs.get(tabId);
    if (tabId === tab.id) {
      await chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          function: loginSalesforce,
          args: [credential.username, credential.password],
        },
        (result) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            return;
          }
          chrome.tabs.onUpdated.addListener(
            checkLoginSuccess(tab.id, credential.faviconColor)
          );
        }
      );
    }
  };

  // 10. Listener to execute login script when a tab is updated.
  const setOnUpdatedListener = (tabId, credential) => {
    chrome.tabs.onUpdated.addListener(function listener(tabIdUpdated, info) {
      if (info.status === "complete" && tabId === tabIdUpdated) {
        console.log("Executing login script..."); // Debug log
        chrome.scripting.executeScript(
          {
            target: { tabId: tabId },
            function: loginSalesforce,
            args: [credential.username, credential.password],
          },
          (result) => {
            if (chrome.runtime.lastError) {
              alert(chrome.runtime.lastError);
              console.error(chrome.runtime.lastError);
              return;
            }
          }
        );
        chrome.tabs.onUpdated.removeListener(listener);
      }
    });
  };

  // 11. Handle login in a new window or incognito mode.
  if (loginType === "newWindow" || loginType === "incognito") {
    const incognito = loginType === "incognito";
    chrome.windows.create({ url: salesforceURL, incognito }, function (window) {
      if (window && Array.isArray(window.tabs) && window.tabs.length > 0) {
        const tab = window.tabs[0];
        console.log(
          `New ${incognito ? "Incognito" : "Regular"} tab created with ID ${
            tab.id
          } and URL ${tab.url}`
        );
        setOnCreatedListener(tab.id, credential);
      } else {
        console.error(
          `No tab found in the new ${
            incognito ? "Incognito" : "Regular"
          } window.`
        );
        alert(
          " go to chrome://extensions/ , find the SalesForceFav extension, and then click on the Details button.Enable  Allow in Incognito"
        );
      }
    });
  } 
  // 12. Handle login in a new tab.
  else if (loginType === "newTab") {
    const tab = await chrome.tabs.create({
      url: salesforceURL,
      active: true,
    });
    setOnCreatedListener(tab.id, credential);
  }
};

/*************************************************************************************** */

// 13. Function to check for successful login and change favicon color.
function checkLoginSuccess(tabId, faviconColor) {
  return async function (tabIdUpdated, info) {
    if (tabId === tabIdUpdated && info.status === "complete") {
      const tab = await chrome.tabs.get(tabIdUpdated);
      if (tab && tab.url) {
        const url = new URL(tab.url);
        console.log("Logged-in URL Origin: ", url.origin);

        // 14. Change the favicon for all tabs with the same origin.
        chrome.tabs.query({}, function (tabs) {
          tabs.forEach((tab) => {
            const tabUrl = new URL(tab.url);
            if (tabUrl.origin === url.origin) {
              color = hexToRgb(faviconColor);
              changeFavicon(tab.id, color);
            }
          });
        });
      }
    }
  };
}

// 15. Function to change the favicon icon color.
function changeFavicon(tabId, color) {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      function: (color) => {
        let link =
          document.querySelector("link[rel*='icon']") ||
          document.createElement("link");
        link.type = "image/x-icon";
        link.rel = "shortcut icon";

        let canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d"),
          img = new Image();

        img.onload = function () {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          let imageData = ctx.getImageData(0, 0, img.width, img.height),
            data = imageData.data;

          // 16. Change the color of all pixels to the specified color.
          for (let i = 0; i < data.length; i += 4) {
            data[i] = color[0]; // red
            data[i + 1] = color[1]; // green
            data[i + 2] = color[2]; // blue
          }

          ctx.putImageData(imageData, 0, 0);

          link.href = canvas.toDataURL("image/x-icon");
          document.getElementsByTagName("head")[0].appendChild(link);
        };

        img.src = chrome.tabs.get(tabId).favicon;
      },
      args: [color],
    },
    (result) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
    }
  );
}

/*************************************************************************************** */

// 17. Function to simulate login to Salesforce.
async function loginSalesforce(username, password) {
  try {
    const usernameField = document.getElementById("username");
    const passwordField = document.getElementById("password");
    const loginButton = document.querySelector("#Login");

    if (!usernameField) {
      throw new Error("Username field not found.");
    }

    // 18. Simulate a delay to ensure the page is fully loaded.
    await new Promise((resolve) => setTimeout(resolve, 500));

    usernameField.value = username;

    if (!passwordField) {
      throw new Error("Password field not found.");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    passwordField.value = password;

    if (!loginButton) {
      throw new Error("Login button not found.");
    }

    // 19. Trigger the login button click event.
    loginButton.click();
  } catch (error) {
    console.error("An error occurred:", error);

    // 20. Notify the user if an error occurs during login.
    alert(" An error occurred while trying to log in. Please try again.");
  }
}

// 21. Functions to initiate login in different modes (new window, incognito, new tab).
const openInWindow = (credential) => {
  loginToSalesforce(credential, "newWindow");
};

const openIncognito = (credential) => {
  loginToSalesforce(credential, "incognito");
};

const openInTab = (credential) => {
  loginToSalesforce(credential, "newTab");
};

// 22. Function to load saved credentials and display them in the UI.
function loadCredentials(savedCredentials, formContainer) {
  const credentialList = document.getElementById("credentialList");
  if (!credentialList) {
    console.error("credentialList is not available.");
    return;
  }
  credentialList.innerHTML = "";

  // 23. Loop through saved credentials and create a list item for each.
  savedCredentials.forEach((credential, index) => {
    const listItem = createListItem(
      credential,
      index,
      savedCredentials,
      formContainer
    );
    credentialList.appendChild(listItem);
  });
}

// 24. Function to create a list item for each credential.
function createListItem(credential, index, savedCredentials, formContainer) {
  const listItem = document.createElement("li");
  listItem.style.display = "flex";
  listItem.style.justifyContent = "space-between";
  listItem.style.alignItems = "center";
  listItem.style.minHeight = "50px"; // Set minimum height
  listItem.style.flexWrap = "nowrap"; // Don't allow items to wrap
  listItem.style.borderBottom = "1px solid #ccc"; // Add a bottom border

  const nameContainer = document.createElement("div");
  nameContainer.style.border = "1px solid lightgray";
  nameContainer.style.padding = "5px";
  nameContainer.style.textAlign = "center";
  nameContainer.style.fontWeight = "bold";
  nameContainer.style.textShadow = "1px 1px gray";
  nameContainer.style.backgroundColor = credential.faviconColor;

  const nameText = document.createTextNode(credential.credentialName);
  nameContainer.appendChild(nameText);
  listItem.appendChild(nameContainer);

  // 25. Create a div to group 'Edit' and 'Delete' buttons.
  const editDeleteGroup = document.createElement("div");
  editDeleteGroup.style.margin = "0 10px";
  editDeleteGroup.style.display = "flex";

  // 26. Create a div to group 'Tab', 'Window' and 'Incognito' buttons.
  const otherActionsGroup = document.createElement("div");
  otherActionsGroup.style.margin = "0 10px";
  otherActionsGroup.style.display = "flex";

  const buttonTypesEditDelete = ["Edit", "Delete"];
  const buttonTypesOther = ["Tab", "Window", "Incognito"];

  // 27. Loop to create 'Edit' and 'Delete' buttons.
  buttonTypesEditDelete.forEach((type) => {
    const btn = createButton(type, () =>
      handleButtonClick(
        type.toLowerCase(),
        index,
        credential,
        savedCredentials,
        formContainer
      )
    );
    editDeleteGroup.appendChild(btn);
  });

  // 28. Loop to create 'Tab', 'Window', and 'Incognito' buttons.
  buttonTypesOther.forEach((type) => {
    const btn = createButton(type, () =>
      handleButtonClick(
        type.toLowerCase(),
        index,
        credential,
        savedCredentials,
        formContainer
      )
    );
    otherActionsGroup.appendChild(btn);
  });

  listItem.appendChild(editDeleteGroup);
  listItem.appendChild(otherActionsGroup);

  return listItem;
}

// 29. Function to create a button element with appropriate icon and click event.
function createButton(text, onClick) {
  const button = document.createElement("button");
  button.onclick = onClick;
  button.style.marginRight = "5px"; // Add some spacing between buttons

  // Adding Unicode Characters as icons based on the button text
  let unicodeChar = "";
  switch (text.toLowerCase()) {
    case "edit":
      unicodeChar = "&#9998;"; // Pencil symbol
      break;
    case "delete":
      unicodeChar = "&#10006;"; // "X" symbol
      break;
    case "tab":
      unicodeChar = "&#x279C;"; // Plus symbol
      break;
    case "window":
      unicodeChar = "&#x1F5D7;"; // Document symbol
      break;
    case "incognito":
      unicodeChar = "&#x1F92B;"; // Sunglasses for incognito
      break;
    default:
      unicodeChar = "&#x003F;"; // Question mark
  }

  button.innerHTML = unicodeChar; // set button content to Unicode character
  return button;
}

// 30. Function to handle different button clicks (Edit, Delete, Tab, Window, Incognito).
function handleButtonClick(
  type,
  index,
  credential,
  savedCredentials,
  formContainer
) {
  switch (type) {
    case "edit":
      editCredential(index, savedCredentials, formContainer);
      break;
    case "delete":
      deleteCredential(index, savedCredentials, formContainer);
      break;
    case "tab":
      openInTab(credential);
      break;
    case "window":
      openInWindow(credential);
      break;
    case "incognito":
      openIncognito(credential);
      break;
  }
}

// 31. Function to delete a credential from the list.
function deleteCredential(index, savedCredentials, formContainer) {
  savedCredentials.splice(index, 1);
  localStorage.setItem("credentials", JSON.stringify(savedCredentials));
  loadCredentials(savedCredentials, formContainer);
}

// 32. Function to show the form for creating a new credential or editing an existing one.
function showNewCredentialForm(
  savedCredentials,
  formContainer,
  editIndex = null
) {
  formContainer.innerHTML = formHtml;

  const form = document.getElementById("newCredentialForm");

  // Event Listener for 'Environment' field
  const environmentField = document.getElementById("environment");
  const ssoUrlFieldContainer = document.getElementById("ssoUrlFieldContainer");
  const usernameFieldContainer = document.getElementById(
    "usernameFieldContainer"
  );
  const passwordFieldContainer = document.getElementById(
    "passwordFieldContainer"
  );

  environmentField.addEventListener("change", function () {
    // 33. Show/hide fields based on the environment (SSO or standard login).
    if (this.value === "sso") {
      ssoUrlFieldContainer.style.display = "block";
      usernameFieldContainer.style.display = "none";
      passwordFieldContainer.style.display = "none";
      document.getElementById("username").required = false;
      document.getElementById("password").required = false;
    } else {
      ssoUrlFieldContainer.style.display = "none";
      usernameFieldContainer.style.display = "block";
      passwordFieldContainer.style.display = "block";
      document.getElementById("username").required = true;
      document.getElementById("password").required = true;
    }
  });

  // 34. Handle form submission to save the credential.
  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const credentialName = document.getElementById("credentialName").value;
    const environment = document.getElementById("environment").value;
    const ssourl = document.getElementById("ssourl").value;
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const faviconColor = document.getElementById("faviconColor").value;

    const newCredential = {
      credentialName,
      environment,
      ssourl,
      username,
      password,
      faviconColor,
    };

    // 35. If editing an existing credential, update it; otherwise, add new.
    if (editIndex !== null) {
      savedCredentials[editIndex] = newCredential;
    } else {
      savedCredentials.push(newCredential);
    }

    localStorage.setItem("credentials", JSON.stringify(savedCredentials));
    loadCredentials(savedCredentials, formContainer);

    formContainer.innerHTML = "";
    formContainer.style.display = "none";
  });

  // 36. Add event listener for the "Cancel" button to close the form.
  const cancelButton = document.getElementById("cancelForm");
  if (cancelButton) {
    cancelButton.addEventListener("click", function (event) {
      event.preventDefault(); // Prevent form submission
      formContainer.innerHTML = "";
      formContainer.style.display = "none";
    });
  }
}

// 37. Function to edit an existing credential.
function editCredential(index, savedCredentials, formContainer) {
  if (!formContainer) {
    console.error("formContainer is not available.");
    return;
  }

  formContainer.style.display = "block"; // Ensure the formContainer is visible

  const credential = savedCredentials[index];
  showNewCredentialForm(savedCredentials, formContainer, index); // Display the form
  const faviconColorField = document.getElementById("faviconColor");
  const credentialNameField = document.getElementById("credentialName");
  const environmentField = document.getElementById("environment");
  const usernameField = document.getElementById("username");
  const passwordField = document.getElementById("password");
  const ssoUrlField = document.getElementById("ssourl");
  const ssoUrlFieldContainer = document.getElementById("ssoUrlFieldContainer");
  const usernameFieldContainer = document.getElementById(
    "usernameFieldContainer"
  );
  const passwordFieldContainer = document.getElementById(
    "passwordFieldContainer"
  );

  // 38. Populate the form with existing data if editing a credential.

  if (credentialNameField && environmentField && faviconColorField) {
    credentialNameField.value = credential.credentialName || "";
    environmentField.value = credential.environment || "";
    faviconColorField.value = credential.faviconColor || "";
    if (credential.environment === "sso") {
      usernameFieldContainer.style.display = "none";
      passwordFieldContainer.style.display = "none";
      ssoUrlFieldContainer.style.display = "block";
      ssoUrlField.required = true;
      ssoUrlField.value = credential.ssourl || "";
      usernameField.required = false;
      passwordField.required = false;
    } else {
      usernameField.value = credential.username || "";
      passwordField.value = credential.password || "";
      ssoUrlFieldContainer.style.display = "none";
      usernameFieldContainer.style.display = "block";
      passwordFieldContainer.style.display = "block";
      usernameField.required = true;
      passwordField.required = true;
    }

    const cancelButton = document.getElementById("cancelForm");
    if (cancelButton) {
      cancelButton.addEventListener("click", function () {
        formContainer.style.display = "none"; // Hide the form
        editIndex = null;
      });
    }
  } else {
    console.error("One or more form fields are not available.");
  }
}

// 39. Define the HTML structure for the form to add/edit credentials.

const formHtml = `
  <form id="newCredentialForm" class="form-container" style="display: flex; flex-direction: column; width: 50%;">
   <label for="environment">Environment:</label>
    <select id="environment" required>
      <option value="" disabled selected>Select environment</option>
      <option value="sandbox">Sandbox</option>
      <option value="production">Production</option>
      <option value="sso">SSO</option>
    </select>
    <br />
    <label for="credentialName">Credential Name:</label>
    <input type="text" id="credentialName" required />
    <br />
  
    <div id="ssoUrlFieldContainer" style="display: none;">
      <label for="ssourl">SSO-URL:</label>
      <input type="url" id="ssourl" />
      <br />
    </div>
    <div id="usernameFieldContainer" style="display: block;">
      <label for="username">Username:</label>
      <input type="text" id="username"  />
      <br />
    </div>
    <div id="passwordFieldContainer" style="display: block;">
    <br />
      <label for="password">Password:</label>
      <input type="password" id="password" />
       </div>
      <br />
       <label for="faviconColor">Favicon Color:</label>
      <input type="color" id="faviconColor" />
    <br />
   
    <input type="submit" value="💾" />
    <button id="cancelForm">🚫</button>
  </form>
`;

// 40. Helper function to convert a HEX color to RGB.
function hexToRgb(hex) {
  const bigint = parseInt(hex.substring(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return [r, g, b];
}