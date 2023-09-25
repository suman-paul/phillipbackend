const express = require('express')
const axios = require('axios');
const AesEncryption = require('aes-encryption')
const { randomUUID } = require('crypto');
const app = express();
const WebSocket = require('ws');
var cors = require('cors');
var jwt = require('jsonwebtoken');
const { db } = require('./firebase-config-server');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc, collection, or } = require("firebase/firestore");
const path = require('path');
require('dotenv').config()

app.use(cors())
app.use(express.static(path.join(__dirname, 'build')));
app.use(express.json())

const port = process.env.PORT || 8000
const server = app.listen(port, () => {
  console.log(`listening on port ${port}`)
})

const loyalityUrl = process.env.LOYALITY_URL;
const phillipUrl = process.env.PHILLIP_PAY_URL;
const serverUrl = 'https://phillip.cyclic.app';
const jwtSecretToken = process.env.JWT_SECRET_KEY;

const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

const api = new WooCommerceRestApi({
  url: "https://www.cartaloq.com",
  consumerKey: process.env.WOO_CONSUMER_KEY,
  consumerSecret: process.env.WOO_CONSUMER_SECRET,
  version: "wc/v3"
});

const wss = new WebSocket.Server({ server });

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
  const txnId = randomUUID();
  try {
    const tokenResponse = await axios.post(`${phillipUrl}/oauth/token`, {
      "grant_type": "client_credentials",
      "client_id": process.env.PHILLIP_PAY_CLIENT_ID,
      "client_secret": process.env.PHILLIP_PAY_CLIENT_SECRET,
      "scope": "txn-create"
    });
    const token = tokenResponse?.data?.access_token;
    const initTxnResponse = await axios.post(`${phillipUrl}/api/init/transaction`, {
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
    });
    return {
      txnId: initTxnResponse.data.data.txn_id,
      // paymentLink: initTxnResponse.data.data.url
      paymentLink: initTxnResponse.data.data.dplink
    };
  } catch (error) {
    console.log(error);
    return null;
  }
};

const deleteCartFromFirestore = async (cifnumber) => {
  const docRef = doc(db, "cart", cifnumber);
  await deleteDoc(docRef);
};

const saveOrderDataFirestore = async (cifnumber, orderId, txnId) => {
  await addDoc(collection(db, "order"), {
    orderId: orderId,
    txnId: txnId,
    cifnumber: cifnumber,
    timestamp: serverTimestamp()
  })
};

const placeOrderInCartaloq = async (cifnumber, txnId) => {
  try {
    const cartData = await getCartDataByCif(cifnumber);
    if(!cartData) {
      console.log("Cart is empty");
      return -1;
    }
    const products = cartData.products;
    const appliedPoints = cartData.appliedPoints;
    const shippingData = cartData.shippingData;
    const lineItems = products.map((mproduct) => {
      return {
        'product_id': mproduct.productId,
        'quantity': 1,
        ...(mproduct.productVariationId && { 'variation_id': mproduct.productVariationId })
      };
    });
    const billingShipping = {
      "first_name": shippingData.firstName,
      "last_name": shippingData.lastName,
      "address_1": shippingData.address1,
      "address_2": shippingData.address2,
      "city": shippingData.town,
      "state": shippingData.state,
      "postcode": shippingData.zip,
      "country": shippingData.country,
      "email": shippingData.email,
      "phone": shippingData.phone
    };

    const response = await api.post("orders", {
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
    });
    console.log("Order created with id: "+response.data.id);
    try {
      await saveOrderDataFirestore(cifnumber, response.data.id, txnId);
      await deleteCartFromFirestore(cifnumber);
      await callPhillipRealtimeAPI(cifnumber, txnId ?? response.data.id?.toString());
    } catch (error) {
      console.log(error)
    }
    return response.data.id;
  } catch (error) {
    console.log("Order creation unsuccessful: ", error);
    return null;
  }
  
};

const callPhillipRealtimeAPI = async (cifnumber, txnId) => {
  const response = await axios.post("https://apigw-uat.phillipbank.com.kh/md-internal/v1/redeem-hook", {
    "point": 0,
    "reference_id": txnId,
    "cif_number": cifnumber
  }, {
    headers: { Authorization: "Bearer eyJ4NXQiOiJOMkpqTWpOaU0yRXhZalJrTnpaalptWTFZVEF4Tm1GbE5qZzRPV1UxWVdRMll6YzFObVk1TlEiLCJraWQiOiJNREpsTmpJeE4yRTFPR1psT0dWbU1HUXhPVEZsTXpCbU5tRmpaalEwWTJZd09HWTBOMkkwWXpFNFl6WmpOalJoWW1SbU1tUTBPRGRpTkRoak1HRXdNQV9SUzI1NiIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJhZG1pbiIsImF1dCI6IkFQUExJQ0FUSU9OIiwiYXVkIjoiVmJveWdSOVNhWmU5UV96X0FpRGg3MnhIMV9ZYSIsIm5iZiI6MTY5MTU2ODYyNywiYXpwIjoiVmJveWdSOVNhWmU5UV96X0FpRGg3MnhIMV9ZYSIsInNjb3BlIjoiZGVmYXVsdCIsImlzcyI6Imh0dHBzOlwvXC9hcGljcC11YXQucGhpbGxpcGJhbmsuY29tLmtoOjQ0M1wvb2F1dGgyXC90b2tlbiIsInJlYWxtIjp7InNpZ25pbmdfdGVuYW50IjoiY2FyYm9uLnN1cGVyIn0sImV4cCI6MTY5MTU3MjIyNywiaWF0IjoxNjkxNTY4NjI3LCJqdGkiOiIxZTJlYjNjNy0wMTQ2LTRhZGMtOTg0Zi1jNWUxMTM5NjA1NGYifQ.jI1YWEbEU1jzbCdIeQ4DTjfIUlFQ4iJpkPWs64oBxevTK6bPh8V0btkGnftuLNxGuMGYwVfC09pwOnPYo4MpnFLmToCz0xo-sXOZpiFRNxQU1-Xfm63o2t2cPW9IF8D-MaWkmgJm07tyo5xpTu9hpkPGmr5OGdw7bijpjaijnlb7CjpFP5vch7GXJMEwc9UmowBd31vKyO1TJMGxw2x-0YSEI_em8G8V4N1-SIjktcOHEkkk8c5rKOTPRJFZ0TZn2ry7IKG4bHGtwfkO4_7X-ydErPx-997IelVW4FLdePzwD2SWPy_olhk5lO0MqRr0CmyOzdbuUXdgv2N_4EXTug" }
  });
  console.log(response)
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
    try {
      const cartData = await getCartDataByCif(cifnumber)
      if(!cartData) {
        console.log("Cart is empty");
        return;
      }
      const products = cartData?.products
      const appliedPoints = cartData?.appliedPoints
      let price = 0
      if(!products) {
        console.log("products is null")
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
          console.log("product is null")
          res.status(500).send() //if no product then internal server error
          return
        }
        const productPrice = parseFloat(parseFloat(product?.price).toFixed(2))
        price += productPrice
      };
      const adjustedAmount = price - parseFloat((parseFloat(appliedPoints) / 100).toFixed(2))
      // console.log(adjustedAmount)
      // console.log(cifnumber)
      if(adjustedAmount > 0) {
        // res.status(200).json({txnId: "jsBridge", paymentLink: adjustedAmount})
        // return
        // const response = await callNativeJsBridge(cifnumber, adjustedAmount);
        // console.log("response after jsBridge call "+response)
        // if(response !== `PaymentSuccess for ${cifnumber}`) {
          const paymentLinkData = await getPaymentLink(adjustedAmount, cifnumber)
          if(!paymentLinkData) {
            console.log("paymentLinkData is null")
            res.status(500).send()
            return
          }
          const {txnId, paymentLink} = paymentLinkData
          // saveOrderDataFirestore(cifnumber, null, txnId)
          if(paymentLink) {
            res.status(200).json(paymentLinkData)
          } else {
            console.log("paymentLink is null")
            res.status(500).send()
          }
          return
        // }
      }

      //create order in cartaloq if everything above succeed
      const orderId = await placeOrderInCartaloq(cifnumber, null)
      if(orderId && (orderId != -1)) {
        res.status(200).json({txnId: orderId, paymentLink: null})
      } else {
        res.status(500).send()
      }
      
    } catch (error) {
      console.log(error)
      res.status(500).send()
    }
    
  } else {
    res.status(300).send()
  }
})

app.post('/place_order', async (req, res) => {
  const cifnumber = req.body.cifnumber
  try {
    const orderId = await placeOrderInCartaloq(cifnumber, null)
    if(orderId && (orderId != -1)) {
      res.status(200).json({txnId: orderId, paymentLink: null})
    } else {
      console.log("orderId: " + orderId)
      res.status(500).send()
    }
  } catch (error) {
    console.log(error)
    res.status(500).send()
  }
})

app.get('/redirect_payment_success/:cifnumber/:txnId', async (req, res) => {
    const cifnumber = req.params.cifnumber
    const txnId = req.params.txnId

    try {
      const orderId = await placeOrderInCartaloq(cifnumber, txnId)
      if(orderId && (orderId != -1)) {
        try {
          const successUrl = `/redirect_payment_success/${cifnumber}/${txnId}`;
          // Trigger the redirect by sending a WebSocket message to connected clients
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ redirectTo: successUrl }));
            }
          });
          res.status(200).send('Redirect triggered.');
        } catch (error) {
          console.log(error)
        }
        // res.status(200).json({txnId: orderId, paymentLink: null})
      } else {
        console.log("orderId: " + orderId);
        res.status(200).json({txnId: null, paymentLink: null});
      }
    } catch (error) {
      console.log(error)
      res.status(500).send()
    }
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
  // console.log(encrypted_cifnumber)
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

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Optionally, you can handle disconnects
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});


