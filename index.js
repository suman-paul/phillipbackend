const express = require('express')
const axios = require('axios');
const AesEncryption = require('aes-encryption')
const { randomUUID } = require('crypto');
const app = express()
var cors = require('cors');
var jwt = require('jsonwebtoken');
const { db } = require('./firebase-config-server');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } = require("firebase/firestore");
const path = require('path');
require('dotenv').config()

app.use(cors())
app.use(express.static(path.join(__dirname, 'build')));
app.use(express.json())

const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

const loyalityUrl = process.env.LOYALITY_URL;
const phillipUrl = process.env.PHILLIP_PAY_URL;
const serverUrl = 'https://phillip.cyclic.app';
const jwtSecretToken = process.env.JWT_SECRET_KEY;

const api = new WooCommerceRestApi({
  url: "https://www.cartaloq.com",
  consumerKey: process.env.WOO_CONSUMER_KEY,
  consumerSecret: process.env.WOO_CONSUMER_SECRET,
  version: "wc/v3"
});

// const api = {
//   get: async function (url, params = {}) {
//     try {
//       const fullUrl = `https://www.cartaloq.com/wp-json/wc/v3/${url}`;
//       const response = await axios.get(fullUrl, {
//         auth: {
//           username: process.env.WOO_CONSUMER_KEY,
//           password: process.env.WOO_CONSUMER_SECRET
//         },
//         params: params
//       });
//       const responseData = response.data;
//       if((responseData.status == 400) || (responseData.status == 401)|| (responseData.status == 404) || (responseData.status == 500))
//         return null;
//       else
//         return responseData;
//     } catch (error) {
//       console.error('Error making GET request:', error);
//       return null;
//     }
//   },

//   post: async function (url, body) {
//     try {
//       const fullUrl = `https://www.cartaloq.com/wp-json/wc/v3/${url}`;
//       const response = await axios.post(fullUrl, body, {
//         auth: {
//           username: process.env.WOO_CONSUMER_KEY,
//           password: process.env.WOO_CONSUMER_SECRET
//         }
//       });
//       const responseData = response.data;
//       return responseData;

//     } catch (error) {
//       console.error('Error making POST request:', error);
//       return null;
//     }
//   }
// };

async function searchProducts(searchString) {
    return api.get("products", {
        search: searchString,
    })
}

async function getProductById(pId) {
  return api.get(`products/${pId}`)
}

async function getProductVariationsById(pId) {
  return api.get(`products/${pId}/variations`)
}

async function getProductVariationByVariationId(pId, vId) {
  return api.get(`products/${pId}/variations/${vId}`)
}

const getCartDataByCif = async (cifnumber) => {
  const docRef = doc(db, "cart", cifnumber);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data()
    } else {
      // docSnap.data() will be undefined in this case
      console.log("No such document!");
      return null
    }
}

const getPaymentLink = async (amount, cifnumber) => {
  const txnId = randomUUID()
  axios.post(`${phillipUrl}/oauth/token`, {
    "grant_type": "client_credentials",
    "client_id": process.env.PHILLIP_PAY_CLIENT_ID,
    "client_secret": process.env.PHILLIP_PAY_CLIENT_SECRET,
    "scope": "txn-create"
  }).then(response => {
    const token = response.data.access_token
    axios.post(`${phillipUrl}/api/init/transaction`, {
      "partner_id": "MD",
      "merchant_id": "20231",
      "merchant_name": "Loyalty MD",
      "merchant_city": "Phnom Penh",
      "merchant_category": "5999",
      "merchant_rdn": "https://www.md.com",
      "phone": "095333003",
      "payload": "Item1,Item2,",
      "txn_id": txnId,
      "label": "Invoice No",
      "currency": "USD",
      "amount": parseFloat(amount),
      "fee": 0.0,
      "country_code": "KH",
      "success_redirect": `${serverUrl}/redirect_payment_success/${cifnumber}/${txnId}`,
      "fail_redirect": `${serverUrl}/redirect_payment_fail/${cifnumber}/${txnId}`
  }, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(response => {
      return {
        txnId: response.data.data.txn_id,
        paymentLink: response.data.data.url
      }
    })
    .catch(error => {
      console.log(error);
      return null
    });
  })
  .catch(error => {
    console.log(error);
    return null
  });
}

const deleteCartFromFirestore = async (cifnumber) => {
  const docRef = doc(db, "cart", cifnumber)
  await deleteDoc(docRef)
}

const saveOrderDataFirestore = async (cifnumber, orderId, txnId) => {
  const docRef = doc(db, "order", txnId)
  if(orderId) {
    updateDoc(docRef, {
      orderId: orderId,
      cifnumber: cifnumber,
      timestamp: serverTimestamp()
    })
  } else {
    setDoc(docRef, {
      cifnumber: cifnumber,
      timestamp: serverTimestamp()
    })
  }
}

const placeOrderInCartaloq = async (cifnumber, txnId) => {
  const cartData = await getCartDataByCif(cifnumber)
  const products = cartData.products
  const appliedPoints = cartData.appliedPoints
  const shippingData = cartData.shippingData
  const lineItems = products.map((mproduct) => {
    return {
      'product_id': mproduct.productId,
      'quantity': 1,
      ...(mproduct.productVariationId && {'variation_id': mproduct.productVariationId})
    }
  })
  const billingShipping = {
      "first_name": shippingData.firstName,
      "last_name": shippingData.lastName,
      "address_1": shippingData.address1,
      "address_2": shippingData.address2,
      "city": shippingData.town,
      "state": shippingData.state,
      "postcode": shippingData.zip,
      "country":shippingData.country,
      "email": shippingData.email,
      "phone": shippingData.phone
  }
  api.post("orders", {
    "payment_method": "phillip",
    "payment_method_title": "Phillip Bank Transfer",
    "set_paid": true,
    "billing": billingShipping,
    "shipping": billingShipping,
    "line_items": lineItems,
    "shipping_lines": [
      {
        "method_id": "flat_rate",
        "method_title": "Flat Rate",
        "total": "00.00"
      }
    ]
  }).then((res)=> {
    console.log("Order creation successful")
    saveOrderDataFirestore(cifnumber, res.data.id, txnId)
    deleteCartFromFirestore(cifnumber)
    return res.data.id
  }).catch((e)=>{
    console.log("Order creation unsuccessful: ", e)
    return null
  })
}

app.get('/', (req, res) => {
  res.send('Hello')
})

app.get('/products/:productId', async (req, res) => {
  // let ra = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  // console.log(ra)
  product = await getProductById(req.params.productId)
  res.json(product?.data)
})

app.get('/products/:productId/variations', async (req, res) => {
    product = await getProductVariationsById(req.params.productId)
    res.json(product?.data)
})

app.get('/products/:productId/variations/:variationId', async (req, res) => {
  product = await getProductVariationByVariationId(req.params.productId, req.params.variationId)
  res.json(product?.data)
})

app.get('/products', async (req, res) => {
  if(!req.query.search) {
    res.json([])
  }
  products = await searchProducts(req.query.search)
  res.json(products?.data)
})

app.get('/getTestCifNumber', async (req, res) => {
  res.json('CM955834')
})

app.post('/memberName', async(req, res) => {
  cifnumber = req.body.cifnumber
  axios.post(`${loyalityUrl}/GetMemberName`, {
    "cifnumber": cifnumber
  }, {
    auth: {
      username: process.env.LOYALITY_USERNAME,
      password: process.env.LOYALITY_PASSWORD
    }
  }
  
  ).then(response => {
    res.json(response.data.GetMemberNameResult.membername)
  })
  .catch(error => {
    console.log(error);
    res.json(null)
  });
})

app.post('/memberTotalPoints', async(req, res) => {
  cifnumber = req.body.cifnumber
  axios.post(`${loyalityUrl}/GetMemberPoint`, {
    "cifnumber": cifnumber
  }, {
    auth: {
      username: process.env.LOYALITY_USERNAME,
      password: process.env.LOYALITY_PASSWORD
    }
  }
  
  ).then(response => {
    res.json(response.data.GetMemberPointResult.memberpoint)
  })
  .catch(error => {
    console.log(error);
    res.json(null)
  });
})

app.post('/payForCart', async(req, res) => {
  const cifnumber = req.body.cifnumber
  if(cifnumber) {
    const cartData = await getCartDataByCif(cifnumber)
    const products = cartData?.products
    const appliedPoints = cartData?.appliedPoints
    let price = 0
    if(!products) {
      res.status(500).send() //if products is null then internal server error
      return
    }
    for await (const mproduct of products) {
      const pId = mproduct.productId
      const vId = mproduct.productVariationId
      const product = vId ?
        (await getProductVariationByVariationId(pId, vId)).data :
        (await getProductById(pId)).data
      if(!product) {
        res.status(500).send() //if no product then internal server error
        return
      } 
      const productPrice = parseFloat(parseFloat(product?.price).toFixed(2))
      price += productPrice
    };
    const adjustedAmount = price - parseFloat((parseFloat(appliedPoints) / 100).toFixed(2))
    const paymentLinkData = await getPaymentLink(adjustedAmount, cifnumber)
    if(!paymentLinkData) {
      res.status(500).send()
      return
    }
    const {txnId, paymentLink} = paymentLinkData
    saveOrderDataFirestore(cifnumber, null, txnId)
    if(paymentLink) {
      res.status(200).json(paymentLinkData)
    } else {
      res.status(500).send()
    }
  } else {
    res.status(300).send()
  }
})

app.get('/redirect_payment_success/:cifnumber/:txnId', async (req, res) => {
    const cifnumber = req.params.cifnumber
    const txnId = req.params.txnId
    const docRef = doc(db, "order", txnId)

    const docSnap = await getDoc(docRef);
    if(docSnap.exists()) {
      placeOrderInCartaloq(cifnumber, txnId)
      res.status(200).send()
    } else {
      res.status(500).send()
    }
  
    // const orderId = await placeOrderInCartaloq(cifnumber, txnId)
    // if(orderId) {
    //   res.status(200).json(orderId)
    // } else {
    //   res.status(500).send()
    // }
})

app.post('/sendEncryptedCif', async(req, res) => {
  const encrypted_cifnumber_hex = req.body.encrypted_cifnumber_hex
  if(encrypted_cifnumber_hex) {
    const aes = new AesEncryption()
    aes.setSecretKey('11122233344455566677788822244455555555555555555231231321313aaaff')
    try {
      const decrypted = aes.decrypt(encrypted_cifnumber_hex)
      res.statusCode = 200
      res.send("CifNumber recorded Sucessfully")
    } catch (error) {
      res.statusCode = 500
      res.send(error.reason)
    }
  } else {
    res.statusCode = 400
    res.send("Enter encrypted_cifnumber_hex in body")
  }
})

app.post('/getCifnumberFromToken', async(req, res) => {
  const encrypted_cifnumber = req.body.encrypted_cifnumber
  console.log(encrypted_cifnumber)
  if(encrypted_cifnumber) {
    try {
      jwt.verify(encrypted_cifnumber, jwtSecretToken, function(err, decoded) {
        if(err) {
          res.statusCode = 422
          res.send(err)
        } else {
          res.statusCode = 200
          const cifnumber = decoded.cifnumber;
          // console.log(cifnumber)
          res.send(cifnumber)
        }
      });
    } catch (error) {
      res.statusCode = 500
      console.log(error)
      res.send(error.reason)
    }
  } else {
    res.statusCode = 400
    res.send("Enter encrypted_cifnumber in body")
  }
})

app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
})

const port = process.env.PORT || 8000

app.listen(port, () => {
  console.log(`listening on port ${port}`)
})