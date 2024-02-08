// ---------------------------------------------------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Icon Loader
 *
 * Queries Chrome's cache for an icon, and may return:
 *
 * - URL
 * - HTMLImageElement
 * - undefined
 *
 * @usage:
 *
 *  const loadIcon = makeIconLoader(32, true)
 *  const image = await loadIcon('google.com')
 *  if (image) { ... }
 *  else { ... }
 *
 * @param   {number}    size          Default icon size
 * @returns {(function(*): Promise<HTMLImageElement|string|undefined>)|*}
 */
function makeIconLoader (size = 16) {

  // -------------------------------------------------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------------------------------------------------

  // setup canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { alpha: false })

  // set up missing
  let missingData

  /**
   * Converts an image to a data URL
   *
   * @param   {CanvasImageSource} image
   * @returns {string}
   * @private
   */
  function getDataUrl (image) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    return canvas.toDataURL()
  }

  /**
   * Builds an icon URL of the format:
   *
   * - chrome-extension://EXTENSION_ID/_favicon/?pageUrl=https%3A%2F%2Fwww.google.com&size=32
   *
   * @param   {string}  domain
   * @returns {string}
   */
  function getIconUrl (domain) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'))
    url.searchParams.set('pageUrl', `https://${domain}`)
    url.searchParams.set('size', String(size))
    return url.toString()
  }

  /**
   * Creates and loads an image
   *
   * @param   {string}  url
   * @returns {Promise<HTMLImageElement>}
   * @private
   */
  async function loadImage (url) {
    return new Promise(function (resolve) {
      const img = document.createElement('img')
      img.src = url
      img.addEventListener('load', function onLoad () {
        img.removeEventListener('load', onLoad)
        resolve(img)
      })
    })
  }

  /**
   * Test if image data is the same as missing data
   *
   * @param   {HTMLImageElement}  image
   * @returns {Promise<boolean>}
   * @private
   */
  async function testImage (image) {
    const imageData = getDataUrl(image)
    return imageData === missingData
  }

  // -------------------------------------------------------------------------------------------------------------------
  // public
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Initialize missing data
   *
   * @returns {Promise<void>}
   */
  async function init () {
    const missingImage = await loadImage(getIconUrl(''))
    missingData = getDataUrl(missingImage)
  }

  /**
   * Checks if a loaded icon image is the same as a missing icon
   *
   * @param   {HTMLImageElement}  image
   * @returns {Promise<boolean>}
   */
  function initIcon (image) {
    return new Promise(function (resolve) {
      image.addEventListener('load', function onLoad () {
        image.removeEventListener('load', onLoad)
        testImage(image).then(resolve)
      })
    })
  }

  // return the load icon function
  return {
    init,
    initIcon,
    getIconUrl,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Counts total number of bookmarks
 *
 * @param   {BookmarkTreeNode}  bookmark
 * @returns {number}
 */
function countBookmarks (bookmark) {
  let count = 0
  if (bookmark.children) {
    for (const child of bookmark.children) {
      count += countBookmarks(child)
    }
    return count
  }
  return count + 1
}


/**
 * Loads bookmarks and gets the first n domains
 *
 * @param   {BookmarkTreeNode}  bookmark    Initial bookmark tree to grab domains from
 * @param   {number}            limit       Limit the number of domains returned
 * @param   {Set<string>}      [_domains]   Private parameter of set of domains
 * @returns {string[]}                      An array of domains
 */
function getDomains (bookmark, limit = 100, _domains = new Set()) {
  // got all domains; give up
  if (_domains.size >= limit) {
    return Array.from(_domains)
  }

  // got bookmark
  if (bookmark.url) {
    if (_domains.size < limit) {
      const url = new URL(bookmark.url)
      if (url.protocol === 'https:') {
        _domains.add(url.hostname)
      }
    }
  }
  else if (bookmark.children) {
    for (bookmark of bookmark.children) {
      getDomains(bookmark, limit, _domains)
    }
  }

  // return
  return Array.from(_domains)
}

/**
 * Loads a tab and exists when a favicon is found
 *
 * @param   {string}  domain    The domain to load
 * @param   {number}  timeout   Milliseconds until timeout / close the tab
 * @returns {Promise<string>}   Any favIconUrl
 */
function fetchFavIcon (domain, timeout = 5000) {
  return new Promise(async function (resolve) {
    const { id } = await chrome.tabs.create({ url: `https://${domain}`, active: false })
    const onUpdated = (tabId, info, tab) => {
      if (tabId === id && tab.favIconUrl) {
        finish(tab.favIconUrl)
      }
    }
    const finish = (favIconUrl = '') => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.remove(id)
      clearTimeout(timeoutId)
      resolve(favIconUrl)
    }
    const timeoutId = setTimeout(finish, timeout)
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------------------------------------------------

// instantiate the loader
const loader = makeIconLoader()

/*
  This code:

  - load bookmarks
  - grab domains
  - loads favicons

  In the main loop, the initIcon() function:

  - attaches a load listener
  - on load, compares the loaded icon to the missing icon
  - returns the result
  - adds a red outline to missing icons

  You can then:

  - attempt to load the missing icon:
    - Click the missing icon
    - this loads the tab and grab the favicon as soon as it is ready
    - this will add the icon to chrome's cache
  - load the tab and manually check
    - Ctrl/Cmd+Click a missing icon
    - check the tab to see if the site loaded or not

  Finally:

  - right-click and inspect the popup for debug info
 */
chrome.bookmarks.getTree(async function (bookmarks) {
  // grab domains
  const root = bookmarks[0]
  const domains = getDomains(root, 2_000)
  const totalBookmarks = countBookmarks(root)

  // prepare missing data
  await loader.init()

  // stats
  let missing = 0
  let total = 0
  const time = Date.now()
  const done = () => {
    console.log(`counted ${totalBookmarks} bookmarks`)
    console.log(`processed ${domains.length} icons in ${Date.now() - time}ms`)
    console.log(`  - missing: ${missing}`)
    console.log(`  - added: ${domains.length - missing}`)
  }

  // loop over icons and add
  for (const domain of domains) {
    // create image
    const img = document.createElement('img')
    img.src = loader.getIconUrl(domain)
    img.title = domain
    document.body.appendChild(img)

    // load image
    img.addEventListener('click', async function (event) {
      // modifier key - open in new tab
      if (event.ctrlKey || event.metaKey) {
        void chrome.tabs.create({ url: `https://${domain}`, active: false })
      }

      // normal click - attempt to load favicon by opening tab
      else {
        const favIconUrl = await fetchFavIcon(domain)
        console.log(`Favicon for ${domain}: ${favIconUrl}`)
        if (favIconUrl) {
          img.src = favIconUrl
        }
      }
    })

    // missing icon listener
    loader.initIcon(img).then(isMissing => {
      // highlight missing
      if (isMissing) {
        img.classList.add('missing')
        missing++
      }

      // stats
      if (++total === domains.length) {
        done()
      }
    })
  }
})
