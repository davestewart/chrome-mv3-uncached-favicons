// ---------------------------------------------------------------------------------------------------------------------
// main helper
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Icon Tester
 *
 * Tests Chrome's favicons to see if they're missing.
 *
 * @param   {number}    size          Default icon size
 */
function makeIconTester (size = 16) {

  // -------------------------------------------------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------------------------------------------------

  // canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { alpha: false })
  let missingData = ''

  /**
   * Converts an image to a data URL
   *
   * @param   {CanvasImageSource} image
   * @returns {string}
   * @private
   */
  function getDataUrl (image) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, canvas.width, 0)

    // this is the "slow" bit
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
   * @returns {boolean}
   * @private
   */
  function compareImage (image) {
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
   * Checks if image icon data is the same as a missing icon image data
   *
   * @param   {HTMLImageElement}  image
   * @returns {Promise<boolean>}
   */
  async function testIcon (image) {
    if (image.complete) {
      return compareImage(image)
    }
    return new Promise(function (resolve) {
      image.addEventListener('load', function onLoad () {
        image.removeEventListener('load', onLoad)
        resolve(compareImage(image))
      })
    })
  }

  // return the load icon function
  return {
    init,
    testIcon,
    getIconUrl,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// demo utils
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
 * Gets unique bookmark domains
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
// demo
// ---------------------------------------------------------------------------------------------------------------------

// instantiate tester
const iconTester = makeIconTester()

// display bookmark icons
chrome.bookmarks.getTree(async function (bookmarks) {
  // grab domains
  const root = bookmarks[0]
  const domains = getDomains(root, 2_000)
  const totalBookmarks = countBookmarks(root)

  // prepare missing data
  await iconTester.init()

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
    img.src = iconTester.getIconUrl(domain)
    img.title = domain
    document.body.appendChild(img)

    // load image
    img.addEventListener('click', async function (event) {
      // modifier key - open in new tab
      if (event.ctrlKey || event.metaKey) {
        void chrome.tabs.create({ url: `https://${domain}`, active: false })
      }

      // normal click - attempt to load favicon by opening tab
      else if (img.classList.contains('missing')) {
        const favIconUrl = await fetchFavIcon(domain)
        console.log(`Favicon for ${domain}: ${favIconUrl}`)
        if (favIconUrl) {
          img.classList.remove('missing')
          img.src = favIconUrl
        }
      }
    })

    // tests for missing icon on icon load
    iconTester.testIcon(img).then(isMissing => {
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
