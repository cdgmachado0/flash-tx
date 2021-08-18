const { legos } = require("@studydefi/money-legos");
// const uniRouterABI = require('../artifacts/@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol/IUniswapV2Router02.json').abi;
const fetch = require("node-fetch");
const { generatePseudoRandomSalt, Order, signatureUtils } = require('@0x/order-utils');



const { createQueryString, API_QUOTE_URL, getQuote, getQuote2 } = require('./relayer.js');
const { parseEther, parseUnits, formatEther, defaultAbiCoder } = ethers.utils;
const { MaxUint256 } = ethers.constants;

const soloMarginAddr = legos.dydx.soloMargin.address;
const wethAddr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; 
const wbtcAdr = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const bntAddr = '0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C';
const offchainRelayer = '0x56178a0d5F301bAf6CF3e1Cd53d9863437345Bf9';
const callerContract = '0x278261c4545d65a81ec449945e83a236666B64F5';
const lendingPoolAaveAddr = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
const usdcAddr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const uniswapRouterAddr = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const borrowed = parseEther('6478.183133980298798568');
let value;


async function getHealthFactor(_receipt) {
  const { data } = _receipt.logs[0];
  const decodedData = defaultAbiCoder.decode(["uint256"], data);
  return formatEther(decodedData.toString());
}





async function main() {
  console.log('--------------------------- Deployed contracts ---------------------------');
  console.log('.');
  const provider = hre.ethers.provider;
  const signer = await hre.ethers.provider.getSigner(0);
  const signerAddr = await signer.getAddress();
  console.log('Deployers address: ', signerAddr);


  //Deploy the Helpers library
  const Helpers = await hre.ethers.getContractFactory('Helpers');
  const helpers = await Helpers.deploy();
  await helpers.deployed();
  console.log('Helpers deployed to: ', helpers.address);

  //Deploys the Swaper0x contract
  const Swaper0x = await hre.ethers.getContractFactory('Swaper0x', {
    libraries: {
      Helpers: helpers.address
    }
  });
  const swaper0x = await Swaper0x.deploy();
  await swaper0x.deployed();
  console.log('Swaper0x deployed to: ', swaper0x.address);
  
  //Deploys the 2nd part of the logic contract first
  const RevengeOfTheFlash = await hre.ethers.getContractFactory('RevengeOfTheFlash', {
    libraries: {
      Helpers: helpers.address
    }
  });
  const revengeOfTheFlash = await RevengeOfTheFlash.deploy();
  await revengeOfTheFlash.deployed();
  console.log('Revenge Of The Flash deployed to: ', revengeOfTheFlash.address);

  //Deploys the logic contract (and links the Helpers library to it)
  // const FlashLoaner = await hre.ethers.getContractFactory('FlashLoaner', {
  //   libraries: {
  //     Helpers: helpers.address
  //   }
  // });
  const FlashLoaner = await hre.ethers.getContractFactory('FlashLoaner');
  const flashlogic = await FlashLoaner.deploy(swaper0x.address, revengeOfTheFlash.address, offchainRelayer);
  await flashlogic.deployed();
  await flashlogic.setExchange(swaper0x.address);
  console.log('flashlogic deployed to: ', flashlogic.address);

  
  //Deploys the proxy where the loan is requested
  const DydxFlashloaner = await hre.ethers.getContractFactory("DydxFlashloaner");
  const dxdxFlashloaner = await DydxFlashloaner.deploy(flashlogic.address, borrowed);
  await dxdxFlashloaner.deployed();
  console.log("dYdX_flashloaner deployed to:", dxdxFlashloaner.address);
  console.log('.');




  console.log('--------------------------- Health Factor Management (AAVE) ---------------------------');
  console.log('.');
  
  const usdcToBorrow = 17895868 * 10 ** 6;

  const aaveDataProviderAddr = '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d';
  const aaveDataProvider = await hre.ethers.getContractAt('IAaveProtocolDataProvider', aaveDataProviderAddr);
  let tx = await aaveDataProvider.getUserReserveData(usdcAddr, callerContract);
  const borrowedUSDC = tx[2].toString();
  
  tx = await swaper0x.getUserHealthFactor_aave(callerContract);
  let receipt = await tx.wait();
  let callerHF = await getHealthFactor(receipt);
  console.log("Caller's health factor pre-ETH deposit: ", callerHF);

  //Sends ETH to original Caller for paying the fees of withdrawing USDC from lending pool
  await signer.sendTransaction({
    value: parseEther('0.1'),
    to: callerContract
  }); 

  //Sends ETH to original caller which will be used to increase healh factor
  value = parseEther('4505.879348962757498457');
  await signer.sendTransaction({
    value,
    to: callerContract
  }); 
  
  //Trades USDC for the borrowed amount made by the caller
  const uniswapRouter = await hre.ethers.getContractAt('IUniswapV2Router02', uniswapRouterAddr);
  const path = [wethAddr, usdcAddr];
  await uniswapRouter.swapETHForExactTokens(borrowedUSDC, path, flashlogic.address, MaxUint256, {
    value: parseEther('5100')
  });



  await hre.network.provider.request({  
    method: "hardhat_impersonateAccount",
    params: [callerContract],
  });
  
  const callerSign = await ethers.getSigner(callerContract);
  const IWETHgateway = await hre.ethers.getContractAt('IWETHgateway', '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04');
  const lendingPoolAave = await hre.ethers.getContractAt('MyILendingPool', lendingPoolAaveAddr);

  //Deposit ETH in lending pool to increase health factor (caller)
  await IWETHgateway.connect(callerSign).depositETH(lendingPoolAaveAddr, callerContract, 0, { value });
  tx = await swaper0x.getUserHealthFactor_aave(callerContract);
  receipt = await tx.wait();
  callerHF = await getHealthFactor(receipt);
  console.log("Caller's health factor after ETH deposit: ", callerHF);

  //Withdraw USDC from lending pool and send them to Flashlogic
  await lendingPoolAave.connect(callerSign).withdraw(usdcAddr, usdcToBorrow, flashlogic.address);

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [offchainRelayer],
  });

  
  
  //Impersonates Flashlogic for making the deposit to the lending pool
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [flashlogic.address],
  });
  
  const flashlogicSign = await ethers.getSigner(flashlogic.address);
  
  //Sends ETH for paying the fees for depositing into the lending pool
  await signer.sendTransaction({
    value: parseEther('0.1'),
    to: flashlogic.address
  });
  
  const burnerAddr = '0x0000000000000000000000000000000000000000';
  
  console.log('hi');
  const IUSDC = await hre.ethers.getContractAt('MyIERC20', usdcAddr);
  const totalUSDCdeposit = usdcToBorrow + Number(borrowedUSDC);

  await IUSDC.connect(flashlogicSign).approve(lendingPoolAaveAddr, totalUSDCdeposit);
  await lendingPoolAave.connect(flashlogicSign).deposit(usdcAddr, totalUSDCdeposit, flashlogic.address, 0);
  console.log('h2');
  await lendingPoolAave.connect(flashlogicSign).borrow(usdcAddr, borrowedUSDC, 2, 0, flashlogic.address);
  IUSDC.connect(flashlogicSign).transfer(burnerAddr, Number(borrowedUSDC));

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [flashlogic.address],
  });

 //...get the original caller's userData (before depositing the ETH and with the USD)
 //put it in the beginning, get flashlogic's data, put it here and compare it both

  // tx = await swaper0x.getUserHealthFactor_aave(flashlogic.address);
  // receipt = await tx.wait();
  // callerHF = await getHealthFactor(receipt);
  // console.log("Caller's health factor after ETH deposit: ", callerHF);
  


  console.log('--------------------------- ---------------- ---------------------------');

  //Sends 2 gwei to the Proxy contract (dYdX flashloaner)
  const IWETH = await hre.ethers.getContractAt('IWETH', wethAddr);
  value = parseUnits('2', "gwei"); //gwei
  await IWETH.deposit({ value });
  await IWETH.transfer(dxdxFlashloaner.address, value);

  
  /**** Sending 72 ETH while I solve the 0x problem ****/
  // value = parseUnits('73', "ether"); //gwei
  // await IWeth.deposit({ value });
  // await IWeth.transfer(flashlogic.address, value);


  //** impersonating..... */
  const IBNT = await hre.ethers.getContractAt('MyIERC20', bntAddr);
  const IWBTC = await hre.ethers.getContractAt('MyIERC20', wbtcAdr);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [offchainRelayer],
  });
  
  const signerImp = await ethers.getSigner(offchainRelayer);
  //1st swap (USDC to BNT - transfer BNT) //call approve from the swaper0x contract
  await IBNT.connect(signerImp).transfer(swaper0x.address, parseEther('1506.932141071984328329'));
  //2nd swap (TUSD to WETH - transfer WETH)
  await IWETH.connect(signerImp).transfer(swaper0x.address, parseEther('224.817255779374783216'));
  //3rd swap (USDC to WBTC - transfer WBTC)
  await IWBTC.connect(signerImp).transfer(swaper0x.address, 19.30930945 * 10 ** 8);
  //4th swap (WBTC to WETH - transfer WETH)
  await IWETH.connect(signerImp).transfer(swaper0x.address, parseEther('253.071556591057205072'));
  //5th swap (USDT to WETH - transfer WETH)
  await IWETH.connect(signerImp).transfer(swaper0x.address, parseEther('239.890714288415882321'));
  //6th swap (USDC to WETH - transfer WETH)
  await IWETH.connect(signerImp).transfer(swaper0x.address, parseEther('231.15052891491875094'));


  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [offchainRelayer],
  });
//**** end of impersonating */


  

/*****  0x quotes *********/

  // const qs = createQueryString({
  //   sellToken: 'TUSD',
  //   buyToken: 'WETH',
  //   sellAmount: BigInt(882693 * 10 ** 18), //11184 * 10 ** 6
  //   // includedSources: 'Uniswap_V2'
  // }); 
  
  // const quoteUrl = `${API_QUOTE_URL}?${qs}&slippagePercentage=0.8`;
  // const response = await fetch(quoteUrl);
  // const quote = await response.json();


  // console.log('the quote: ', quote);
  // const quoteAddr = [
  //   quote.sellTokenAddress,
  //   quote.buyTokenAddress,
  //   quote.allowanceTarget, 
  //   quote.to
  // ];



/*****  0x quotes *********/


// let value2 = parseEther('1');
// await signer.sendTransaction({
//   value: value2,
//   to: flashlogic.address
// });



  const quotes_bytes_0x = [];
  const quotes_addr_0x = [];

  const USDCBNT_0x_quote = await getQuote('USDC', 'BNT', 11184 * 10 ** 6);
  quotes_addr_0x[0] = USDCBNT_0x_quote.addresses;
  quotes_bytes_0x[0] = USDCBNT_0x_quote.bytes; 


  const TUSDWETH_0x_quote = await getQuote('TUSD', 'WETH', BigInt(882693 * 10 ** 18)); 
  quotes_addr_0x[1] = TUSDWETH_0x_quote.addresses; 
  quotes_bytes_0x[1] = TUSDWETH_0x_quote.bytes; 
                                                
  
  const USDCWBTC_0x_quote = await getQuote('USDC', 'WBTC', 984272 * 10 ** 6);                                     
  quotes_addr_0x[2] = USDCWBTC_0x_quote.addresses;
  quotes_bytes_0x[2] = USDCWBTC_0x_quote.bytes;


  /***** 2nd impersonating *****/
  

  // //send ETH for paying the fees
  // let value2 = parseEther('0.1');
  // await signer.sendTransaction({
  //   value: value2,
  //   to: callerContract
  // }); 

  // value2 = parseEther('6478');
  // await signer.sendTransaction({
  //   value: value2,
  //   to: callerContract
  // }); 


  // await hre.network.provider.request({
  //   method: "hardhat_impersonateAccount",
  //   params: [callerContract],
  // });

  // const callerSign = await ethers.getSigner(callerContract);
                                        
  // await dxdxFlashloaner.connect(callerSign).initiateFlashLoan(
  //   soloMarginAddr, 
  //   wethAddr, 
  //   borrowed,
  //   quotes_addr_0x,
  //   quotes_bytes_0x
  // );

  // const callerBalance = formatEther(await callerSign.getBalance());
  // console.log('balance: ', callerBalance);
  // const IWETHgateway = await hre.ethers.getContractAt('IWETHgateway', '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04');
  // await IWETHgateway.connect(callerSign).depositETH('0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', callerContract, 0, {value: parseEther('6477')});

  // const lendingPoolAave = await hre.ethers.getContractAt('MyILendingPool', '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9');
  // const tx = await lendingPoolAave.connect(callerSign).withdraw('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 17895868 * 10 ** 6, callerContract);
  // const receipt = await tx.wait();
  // console.log('receipt: ', receipt);
  

  // // await swaper0x.connect(callerSign).delegateCredit(dxdxFlashloaner.address);

  // await hre.network.provider.request({
  //   method: "hardhat_stopImpersonatingAccount",
  //   params: [offchainRelayer],
  // });

//**** end of 2nd impersonating ****/







  // await dxdxFlashloaner.initiateFlashLoan(
  //   soloMarginAddr, 
  //   wethAddr, 
  //   borrowed,
  //   quotes_addr_0x,
  //   quotes_bytes_0x
  // );


}






main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
