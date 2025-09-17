/**
 * IPFS Upload Service
 * Handles uploading configuration data to IPFS via QuickNode
 */


export interface UploadResult {
  success: boolean;
  ipfsHash?: string;
  error?: string;
}

/**
 * Get QuickNode API key from config or environment
 */
function getQuickNodeApiKey(apiKey?: string): string {
  const key = apiKey;

  if (!key) {
    throw new Error('QuickNode API key is required - either from config.__env.quickNodeApiKey');
  }

  return key;
}

/**
 * Upload configuration data to IPFS via QuickNode
 */
export async function uploadConfigToIPFS(
  config: Record<string, unknown>,
  environmentName: string,
  quickNodeApiKey?: string
): Promise<UploadResult> {
  try {
    const apiKey = getQuickNodeApiKey(quickNodeApiKey);

    // Create JSON string from config
    const jsonString = JSON.stringify(config, null, 2);
    const fileName = `env-${environmentName}.json`;

    // Check if a file with this name already exists BEFORE uploading
    const { object: existingObject, error: findError } = await findPinnedObjectByName(fileName, apiKey);

    if (findError) {
      console.warn(`Warning: Could not check for existing file: ${findError}`);
    }

    let newCid: string;

    if (existingObject) {
      console.log(`File ${fileName} already exists, deleting existing pinned object...`);

      // Delete the existing pinned object first
      const deleteResult = await deletePinnedObject(existingObject.requestId, apiKey);

      if (!deleteResult.success) {
        throw new Error(`Failed to delete existing file: ${deleteResult.error}`);
      }

      console.log(`Successfully deleted existing file ${fileName}`);
    }

    // Upload the new content (either new file or after deleting existing)
    const formData = new FormData();
    const jsonBlob = new Blob([jsonString], { type: 'application/json' });
    formData.append("Body", jsonBlob, fileName);
    formData.append("Key", fileName);
    formData.append("ContentType", "application/json");

    const uploadResponse = await fetch("https://api.quicknode.com/ipfs/rest/v1/s3/put-object", {
      method: 'POST',
      headers: {
        'x-api-key': apiKey
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`QuickNode upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log('Upload result:', uploadResult); // Debug log

    // Try different possible response formats
    newCid = uploadResult.IpfsHash || uploadResult.cid || uploadResult.hash ||
      uploadResult.pin?.cid || uploadResult.pin?.hash ||
      uploadResult.data?.IpfsHash || uploadResult.data?.cid;

    if (!newCid) {
      console.error('Full upload response:', uploadResult);
      throw new Error(`No IPFS hash returned from QuickNode upload. Response: ${JSON.stringify(uploadResult)}`);
    }

    // If no existing file or update failed, the S3 upload already created the pinned object
    // No additional pinning step needed

    return {
      success: true,
      ipfsHash: newCid
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error'
    };
  }
}

/**
 * Get all pinned objects from QuickNode IPFS
 */
export async function getAllPinnedObjects(
  quickNodeApiKey?: string
): Promise<{ objects: any[]; error?: string }> {
  try {
    const apiKey = getQuickNodeApiKey(quickNodeApiKey);

    // Use the correct endpoint from QuickNode docs: GET Get All PinnedObjects
    const response = await fetch("https://api.quicknode.com/ipfs/rest/v1/pinning?pageNumber=1&perPage=10", {
      method: 'GET',
      headers: {
        'x-api-key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        objects: [],
        error: `Failed to get pinned objects: ${response.status} - ${errorText}`
      };
    }

    const result = await response.json();
    return { objects: result.data || result || [] };
  } catch (error) {
    return {
      objects: [],
      error: error instanceof Error ? error.message : 'Unknown error getting pinned objects'
    };
  }
}

/**
 * Find a pinned object by name
 */
export async function findPinnedObjectByName(
  fileName: string,
  quickNodeApiKey?: string
): Promise<{ object: any | null; error?: string }> {
  try {
    const { objects, error } = await getAllPinnedObjects(quickNodeApiKey);

    if (error) {
      return { object: null, error };
    }

    const foundObject = objects.find((obj: any) => obj.name === fileName);
    return { object: foundObject || null };
  } catch (error) {
    return {
      object: null,
      error: error instanceof Error ? error.message : 'Unknown error finding pinned object'
    };
  }
}

/**
 * Delete a pinned object from QuickNode IPFS
 */
export async function deletePinnedObject(
  requestId: string,
  quickNodeApiKey?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const apiKey = getQuickNodeApiKey(quickNodeApiKey);

    const response = await fetch(`https://api.quicknode.com/ipfs/rest/v1/pinning/${requestId}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Failed to delete pinned object: ${response.status} - ${errorText}`
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error deleting pinned object'
    };
  }
}

/**
 * Check if QuickNode is configured (either via env or config)
 */
export function isQuickNodeConfigured(quickNodeApiKey?: string): boolean {
  return !!(quickNodeApiKey);
}

/**
 * Get upload status message
 */
export function getUploadStatusMessage(environmentName: string): string {
  if (!isQuickNodeConfigured()) {
    return 'QuickNode not configured. Please set quickNodeApiKey in _env section in config';
  }
  return `Ready to upload ${environmentName} configuration to IPFS via QuickNode`;
}


