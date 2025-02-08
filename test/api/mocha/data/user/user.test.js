
import { v4 as uuidv4 } from 'uuid'
import {config } from '../../testConfig.js'
import * as utils from '../../utils/testUtils.js'
import reference from '../../referenceData.js'
import {requestBodies} from "./requestBodies.js"
import {iterations} from '../../iterations.js'
import {expectations} from './expectations.js'
import { expect } from 'chai'

let testUser = null
const randomValue = utils.getUUIDSubString(10)

describe('user', () => {

  before(async function () {
    await utils.loadAppData()
  })

  for(const iteration of iterations) {
    const distinct = expectations[iteration.name]

    describe(`iteration:${iteration.name}`, () => {

      before(async function () {
        await utils.loadAppData()
          // this is here because after we do the gets we need to create a temp user to do all posts, patches, and puts etc on. 
      // as a result we will have an extra user in the gets to consider
        const create =  JSON.parse(JSON.stringify(requestBodies.scrapUser))
        create.username = create.username + utils.getUUIDSubString(10)
        testUser = await utils.createUser(create)
      })

      describe('GET - user', () => {

        describe(`getUser - /user`, () => {

          it('Return the requesters user information - check user', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/user`, 'GET', iteration.token)

            expect(res.status).to.eql(200)
            expect(res.body.username, "expect username to be current user").to.equal(iteration.name)
            const userGroupIds = res.body.userGroups.map(group => group.userGroupId)
            expect(userGroupIds).to.eql(distinct.userGroupIds)
            for(const grant of res.body.collectionGrants) {
              expect(grant.collection.collectionId).to.be.oneOf(distinct.collectionGrants)
            }
          })

          it("Return the requesters user information verify last access and priviledges data", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/user`, 'GET', iteration.token)

            expect(res.status).to.eql(200)
            expect(res.body.username, "expect username to be current user").to.equal(iteration.name)
            expect(res.body.lastAccess).to.be.a('number')
            const lastAccessDate = new Date(res.body.lastAccess * 1000)
            expect(lastAccessDate).to.be.lessThan(new Date())
            expect(res.body.privileges).to.eql(distinct.privileges)

          })
        })
        
        describe(`getUsers - /user`, () => {

          it('Return a list of users accessible to the requester USERNAME', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${reference.wfTest.username}&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of users accessible to the requester username with match=exact', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${reference.wfTest.username}&username-match=exact&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of users accessible to the requester username with match=startsWith', async () => {
            // get first 3 characters of username
            const username = reference.wfTest.username.substring(0, 3)
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${username}&username-match=startsWith&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of users accessible to the requester username with match=endsWith', async () => {
            // get last 3 characters of username
            const username = reference.wfTest.username.substring(reference.wfTest.username.length - 3)
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${username}&username-match=endsWith&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of users accessible to the requester username with match=contains', async () => {
            // get middle 3 characters of username
            const username = reference.wfTest.username.substring(3, 6)
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${username}&username-match=contains&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of user accessible to the requester USERNAME no projections', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=${reference.wfTest.username}`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username,"expect user to be wf-test").to.equal('wf-test')
            expect(res.body[0].userId, "expect userId to be wfTest userId").to.equal(reference.wfTest.userId)
          })
          it('Return a list of user accessible to the requester with elevate and projections', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            // plus one for test user created in before
            expect(res.body, "expect to get back all usersIds with elevate").to.be.an('array').of.length(reference.allUserIds.length + 1)
            for(let user of res.body) {
              expect(user).to.have.property('collectionGrants')
              expect(user).to.have.property('statistics')
              expect(user).to.have.property('username')
              expect(user).to.have.property('userId')
              const newIds = reference.allUserIds.concat(testUser.userId)
              expect(user.userId, "expect userId to be one of the users the system").to.be.oneOf(newIds)
            }
          })
          it('Return a list of users accessible to the requester no projections for lvl1 success. ', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users`, 'GET', iteration.token)
      
            expect(res.status).to.eql(200)
            // plus one for test user created in before
            expect(res.body).to.be.an('array').of.length(reference.allUserIds.length + 1)
            for(let user of res.body) {
              // plus one for test user created in before
              const newIds = reference.allUserIds.concat(testUser.userId)
              expect(user.userId, "expect userId to be one of the users the system").to.be.oneOf(newIds)
            }
          })
          it("return lvl1 user and verify its group membership", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&username=lvl1&projection=userGroups`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('array')
            expect(res.body[0].username, "expect username to be lvl1").to.equal('lvl1')
            expect(res.body[0].userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
            expect(res.body[0].userGroups).to.be.an('array')
            expect(res.body[0].userGroups, "expect user to be in TestGroup").to.eql([{ userGroupId: reference.testCollection.testGroup.userGroupId, name: reference.testCollection.testGroup.name }])

          })
          it("should return all users with admin privileges", async () => {

            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&privilege=admin`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)

            for(const user of res.body) {
              expect(user.privileges.admin, "expect user to have admin privilege").to.be.true
            }
          })
          it("should return all users with create_collection privileges", async () => {

            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&privilege=create_collection`, 'GET', iteration.token)

            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            for(const user of res.body) {
              expect(user.privileges.create_collection, "expect user to have create_collection privilege").to.be.true
            }
          })
          it("should throw SmError.PrivilegeError no elevate with projections.", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?projection=collectionGrants`, 'GET', iteration.token)
            expect(res.status).to.eql(403)
          })
        })

        describe(`getUserByUserId - /users{userId}`, async () => {

          it('Return wfTest user user', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.wfTest.userId}?elevate=true&projection=collectionGrants&projection=statistics`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('object')
            expect(res.body).to.have.property('collectionGrants')
            expect(res.body).to.have.property('statistics')
            expect(res.body.username, "expect username to be wf-Test").to.equal(reference.wfTest.username)
            expect(res.body.userId, "expect userId to be wf-Test userId (22)").to.equal(reference.wfTest.userId)
            expect(res.body.privileges).to.eql({admin: false, create_collection: false})
          })
          it("return adminBurke user and verify its privileges", async () => {

            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.adminBurke.userId}?elevate=true`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body.username, "expect username to be admin").to.equal(reference.adminBurke.username)
            expect(res.body.userId, "expect userId to be admin userId").to.equal(reference.adminBurke.userId)
            expect(res.body.privileges).to.eql({admin: true, create_collection: true})
          })
          it("return lvl1 user and verify its group membership", async () => {
            const res =  await utils.executeRequest(`${config.baseUrl}/users/${reference.lvl1User.userId}?elevate=true&projection=userGroups`, 'GET', iteration.token)
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body.username, "expect username to be lvl1").to.equal('lvl1')
            expect(res.body.userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
            expect(res.body.userGroups).to.be.an('array')
            expect(res.body.userGroups, "expect user to be in TestGroup").to.eql([{ userGroupId: reference.testCollection.testGroup.userGroupId, name: reference.testCollection.testGroup.name }])

          })
        })
      })

      describe('POST - user', () => {
        describe(`POST - createUser - /users`, () => {
          
          let tempUser = null
          it('Create a user', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&projection=collectionGrants&projection=statistics`, 'POST', iteration.token, {
                  "username": "TEMP_USER" +  randomValue,
                  "collectionGrants": [
                      {
                          "collectionId": `${reference.scrapCollection.collectionId}`,
                          "roleId": 1
                      }
                  ]
              })
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              tempUser = res.body
              expect(res.status).to.eql(201)
              expect(res.body).to.be.an('object')
              for(let grant of res.body.collectionGrants) {
                expect(grant).to.have.property('collection')
                expect(grant).to.have.property('roleId')
                expect(grant.collection.collectionId, "Expect collectionId to be scrapColleciton Id").to.equal(reference.scrapCollection.collectionId)
              }
              const createdUser = await utils.getUser(res.body.userId)
              expect(createdUser).to.be.an('object')
              expect(createdUser.username, "expecte created userId to be equal to the userId retured from API").to.equal(res.body.username)
              expect(createdUser.userId, ).to.equal(res.body.userId)
              expect(createdUser.collectionGrants).to.be.an('array')
              expect(createdUser.collectionGrants, "expect created user to have a single grant to scrap collection").to.have.lengthOf(1)
          })
          it("Create a user in test userGroup", async () => {
            const uuid10Chars = uuidv4().substring(0, 10)
            const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true&projection=userGroups&projection=collectionGrants`, 'POST', iteration.token, {
                  "username": "TEMP_USER" + uuid10Chars,
                  "userGroups": [reference.testCollection.testGroup.userGroupId],
                  "collectionGrants": []
              })
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(201)
              expect(res.body.username, "expect username to be TEMP_USER").to.equal("TEMP_USER" + uuid10Chars)
              expect(res.body.userGroups).to.be.an('array')
              expect(res.body.userGroups, "expect user to be in TestGroup").to.eql([{ userGroupId: reference.testCollection.testGroup.userGroupId, name: reference.testCollection.testGroup.name }])
              expect(res.body.collectionGrants).to.be.an('array').of.length(1)              
              for(let grant of res.body.collectionGrants) {
                expect(grant.collection.collectionId).to.be.eql(reference.testCollection.collectionId)
                expect(grant.roleId, "expect grant to be restricted").to.equal(reference.testCollection.testGroup.roleId)
                for(const grantee of grant.grantees) {
                  expect(grantee.userGroupId, "expect grantee to be in TestGroup").to.equal(reference.testCollection.testGroup.userGroupId)
                }
              }
          })
          if(iteration.name == "stigmanadmin"){
          
            it('should throw SmError.UnprocessableError collectionIds are invalid.', async () => {
              const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true`, 'POST', iteration.token, {
                    "username": "TEST_USER" + randomValue,
                    "collectionGrants": [
                        {
                            "collectionId": `${"1234321"}`,
                            "roleId": 1
                        }
                    ]
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(422)
            })
            it('should throw SmError.UnprocessableError Duplicate name exists.', async () => {
              const res = await utils.executeRequest(`${config.baseUrl}/users?elevate=true`, 'POST', iteration.token, {
                    "username": `${tempUser.username}`,
                    "collectionGrants": [
                        {
                            "collectionId": `${reference.scrapCollection.collectionId}`,
                            "roleId": 1
                        }
                    ]
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(422)
            })
          }
          if(iteration.name == "stigmanadmin"){
            it('cleanup - delete temp user', async () => {
              const res = await utils.executeRequest(`${config.baseUrl}/users/${tempUser.userId}?elevate=true`, 'DELETE', iteration.token)
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
            })
          }
        
        })
      })

      describe('PATCH - user', () => {

        describe(`PATCH - updateUser - /users{userId}`, async () => {

          it('Merge provided properties with a user - Change Username', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}?elevate=true&projection=collectionGrants&projection=statistics`, 'PATCH', iteration.token, {
                    "username": "PatchTest",
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(200)
                expect(res.body.username).to.equal('PatchTest')
                expect(res.body.userId, "expect userId to be equal to scraplvl1users userId").to.equal(testUser.userId)

                for(let grant of res.body.collectionGrants) {
                  expect(grant).to.have.property('collection')
                  expect(grant).to.have.property('roleId')
                  expect(grant.collection.collectionId, "expect collectionId to be scrapCollection Id").to.equal(reference.scrapCollection.collectionId)
                }

                const userEffected = await utils.getUser(testUser.userId)

                expect(userEffected).to.be.an('object')
                expect(userEffected.username, "expectthe effected user to be the one returned by the api").to.equal(res.body.username)
                expect(userEffected.userId,"expectthe effected user to be the one returned by the api").to.equal(res.body.userId)
          })
          it("edit lvl1 users group membership to no groups. ", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.lvl1User.userId}?elevate=true&projection=userGroups&projection=collectionGrants`, 'PATCH', iteration.token, {
                  "userGroups": []
                })
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
              expect(res.body.username, "expect username to be lvl1").to.equal('lvl1')
              expect(res.body.userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
              expect(res.body.userGroups).to.be.an('array').of.length(0)
              expect(res.body.collectionGrants).to.be.an('array').of.length(0)
          })
          it("add lvl1 user back to test group", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.lvl1User.userId}?elevate=true&projection=userGroups&projection=collectionGrants`, 'PATCH', iteration.token, {
                  "userGroups": [reference.testCollection.testGroup.userGroupId]
                })
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
              expect(res.body.username, "expect username to be lvl1").to.equal('lvl1')
              expect(res.body.userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
              expect(res.body.userGroups).to.be.an('array').of.length(1)
              expect(res.body.userGroups, "expect user to be in TestGroup").to.eql([{ userGroupId: reference.testCollection.testGroup.userGroupId, name: reference.testCollection.testGroup.name }])
              expect(res.body.collectionGrants).to.be.an('array').of.length(1)

          })
          it("should throw SmError.UnprocessableError collectionIds are invalid.", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}?elevate=true`, 'PATCH', iteration.token, {
                  "username": "PatchTest",
                  "collectionGrants": [
                      {
                          "collectionId": `1234321`,
                          "roleId": 1
                      }
                  ]
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(422)
          })
          it("should throw 404 userId doesnt exist.", async () => {

            const res = await utils.executeRequest(`${config.baseUrl}/users/0?elevate=true`, 'PATCH', iteration.token, {
                  "username": "PatchTest",
                  "collectionGrants": [
                      {
                          "collectionId": `${reference.scrapCollection.collectionId}`,
                          "roleId": 1
                      }
                  ]
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(404)
          })
        })
      })

      describe('PUT - user', () => {
        describe(`PUT - replaceUser - /users{userId}`, async () => {

          it(`Set all properties of a user - Change Username`, async () => {
          const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}?elevate=true&projection=collectionGrants&projection=statistics`, 'PUT', iteration.token, {
              "username": "putTesting",
              "collectionGrants": [
                  {
                      "collectionId": `${reference.scrapCollection.collectionId}`,
                      "roleId": 1
                  }
              ]
            })
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(200)
            expect(res.body).to.be.an('object')
            expect(res.body.username, "expect username to be putTesting").to.equal('putTesting')
            expect(res.body.userId, "expect userId to be scraplvl1").to.equal(testUser.userId)
            expect(res.body.collectionGrants).to.be.an('array')
            expect(res.body.statistics).to.be.an('object')

            for(let grant of res.body.collectionGrants) {
              expect(grant).to.have.property('collection')
              expect(grant).to.have.property('roleId')
              expect(grant.collection.collectionId, "expect to have grant to the scrap collection").to.equal(reference.scrapCollection.collectionId)
            }

            const userEffected = await utils.getUser(res.body.userId)

            expect(userEffected).to.be.an('object')
            expect(userEffected.username, "user effected to have username returned by API").to.equal(res.body.username)
            expect(userEffected.userId, "user effected to have Id returned by API").to.equal(res.body.userId)
            expect(userEffected.collectionGrants).to.be.an('array')

          })

          it("should throw SmError.UnprocessableError collectionIds are invalid.", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}?elevate=true`, 'PUT', iteration.token, {
                  "username": "putTesting",
                  "collectionGrants": [
                      {
                          "collectionId": `1234321`,
                          "roleId": 1
                      }
                  ]
                })
                if(iteration.name != "stigmanadmin"){
                  expect(res.status).to.eql(403)
                  return
                }
                expect(res.status).to.eql(422)
          })

          it("edit lvl1 users group membership to no groups and add direct level 1 roleId to test collecton ", async () => {
            const res = await utils.executeRequest(
                `${config.baseUrl}/users/${reference.lvl1User.userId}?elevate=true&projection=userGroups&projection=collectionGrants`,
                'PUT',
                iteration.token,
                {
                  username: "lvl1",
                  collectionGrants: [
                    {
                      roleId: 1,
                      collectionId: reference.testCollection.collectionId,
                    },
                  ],
                  userGroups: [],
                }
              )
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
              expect(res.body.username, "expect username to be lvl1").to.equal('lvl1')
              expect(res.body.userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
              expect(res.body.userGroups).to.be.an('array').of.length(0)
              expect(res.body.collectionGrants).to.be.an('array').of.length(1)
              expect(res.body.collectionGrants[0].collection.collectionId, "expect collectionId to be testCollection").to.equal(reference.testCollection.collectionId)
              expect(res.body.collectionGrants[0].roleId, "expect roleId to be 1").to.equal(1)
              expect(res.body.collectionGrants[0].grantees).to.be.an('array').of.length(1)
              expect(res.body.collectionGrants[0].grantees[0].userId, "expect grantee to be the user").to.equal(reference.lvl1User.userId)
          })

          it("add lvl1 user back to test group", async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.lvl1User.userId}?elevate=true&projection=userGroups&projection=collectionGrants`, 'PUT', iteration.token, {
                    username: "lvl1",
                    collectionGrants: [],
                    userGroups: [reference.testCollection.testGroup.userGroupId]
                })
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
              expect(res.body.username, "expect username to be lvl1").to.equal('lvl1')
              expect(res.body.userId, "expect userId to be lvl1 userId").to.equal(reference.lvl1User.userId)
              expect(res.body.userGroups).to.be.an('array').of.length(1)
              expect(res.body.userGroups, "expect user to be in TestGroup").to.eql([{ userGroupId: reference.testCollection.testGroup.userGroupId, name: reference.testCollection.testGroup.name }])
              expect(res.body.collectionGrants).to.be.an('array').of.length(1)

          })

          it("should throw error, no elevate", async () => {  
            const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}`, 'PUT', iteration.token, {
                  "username": "putTesting",
                  "collectionGrants": [
                      {
                          "collectionId": `${reference.scrapCollection.collectionId}`,
                          "roleId": 1
                      }
                  ]
                })
                expect(res.status).to.eql(403)
          })

          it("should throw 404 userId doesnt exist.", async () => {

            const res = await utils.executeRequest(`${config.baseUrl}/users/0?elevate=true`, 'PUT', iteration.token, {
                  "username": "put",
                  "collectionGrants": [
                      {
                          "collectionId": `${reference.scrapCollection.collectionId}`,
                          "roleId": 1
                      }
                  ]
                })
            if(iteration.name != "stigmanadmin"){
              expect(res.status).to.eql(403)
              return
            }
            expect(res.status).to.eql(404)
          })

        })
      })

      describe('DELETE - user', () => {

        describe(`DELETE - deleteUser - /users/{userId}`, async () => {
          it('Delete a user - fail due to user access record', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.testCollection.collectionOwnerID}?elevate=true&projection=collectionGrants&projection=statistics`, 'DELETE', iteration.token)
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(422)
          })
          it('Delete a user - succeed, as user has never accessed the system', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${reference.deleteUser.userId}?elevate=true`, 'DELETE', iteration.token)
              if(iteration.name != "stigmanadmin"){
                expect(res.status).to.eql(403)
                return
              }
              expect(res.status).to.eql(200)
              const userEffected = await utils.getUser("43")
              expect(userEffected.status, "expect 404 response (user delete worked)").to.equal(404)
          })
          it('Delete a user - not elevated expect fail', async () => {
            const res = await utils.executeRequest(`${config.baseUrl}/users/${43}?elevate=false`, 'DELETE', iteration.token)
              expect(res.status).to.eql(403)
          })
          if(iteration.name === "stigmanadmin"){
            it('Delete test user for cleanup', async () => {
              const res = await utils.executeRequest(`${config.baseUrl}/users/${testUser.userId}?elevate=true`, 'DELETE', iteration.token)
                expect(res.status).to.eql(200)
            })
          }
        })
      
      })
    })
  }
})